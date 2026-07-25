/* ===================================================================
   Quizmefy — Frontend Application Logic
   Full quiz generation flow, auth management, and UI state machine.
   =================================================================== */

'use strict';

// ─── Configuration ────────────────────────────────────────────────────
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:3000/api/v1'
  : '/api/v1';

// ─── State ────────────────────────────────────────────────────────────
const state = {
  accessToken: localStorage.getItem('qm_access_token'),
  refreshToken: localStorage.getItem('qm_refresh_token'),
  user: JSON.parse(localStorage.getItem('qm_user') || 'null'),
  currentQuiz: null,
  currentQuestions: [],
  currentQuestionIndex: 0,
  answers: {},
  score: 0,
  quizId: null,
  isGenerating: false,
  advancedOpen: false,
};

// ─── Auth helpers ─────────────────────────────────────────────────────

function saveAuth(user, tokens) {
  state.user = user;
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  localStorage.setItem('qm_access_token', tokens.accessToken);
  localStorage.setItem('qm_refresh_token', tokens.refreshToken);
  localStorage.setItem('qm_user', JSON.stringify(user));
}

function clearAuth() {
  state.user = null;
  state.accessToken = null;
  state.refreshToken = null;
  localStorage.removeItem('qm_access_token');
  localStorage.removeItem('qm_refresh_token');
  localStorage.removeItem('qm_user');
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Token refresh on 401
  if (res.status === 401 && state.refreshToken && !path.includes('/auth/')) {
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });
      if (refreshRes.ok) {
        const { tokens } = await refreshRes.json();
        state.accessToken = tokens.accessToken;
        state.refreshToken = tokens.refreshToken;
        localStorage.setItem('qm_access_token', tokens.accessToken);
        localStorage.setItem('qm_refresh_token', tokens.refreshToken);
        headers['Authorization'] = `Bearer ${state.accessToken}`;
        return fetch(`${API_BASE}${path}`, { ...options, headers });
      }
    } catch (_) {}
    clearAuth();
    updateAuthUI();
  }

  return res;
}

// ─── UI: Auth state ───────────────────────────────────────────────────

function updateAuthUI() {
  const loginBtn = document.getElementById('nav-login-btn');
  const signupBtn = document.getElementById('nav-signup-btn');
  const authBanner = document.getElementById('auth-banner');
  const authBannerText = document.getElementById('auth-banner-text');
  const authLinkBtn = document.getElementById('auth-link-btn');

  if (state.user) {
    loginBtn.textContent = state.user.displayName || state.user.email?.split('@')[0] || 'Account';
    loginBtn.onclick = () => logout();
    signupBtn.textContent = 'Logout';
    signupBtn.onclick = () => logout();
    authBanner.style.display = 'none';
  } else {
    loginBtn.textContent = 'Login';
    loginBtn.onclick = () => openAuthModal('login');
    signupBtn.textContent = 'Get Started';
    signupBtn.onclick = () => openAuthModal('signup');
    authBanner.style.display = 'flex';
    authBannerText.textContent = 'Login to save quiz history and access your generated quizzes anytime.';
    authLinkBtn.textContent = 'Login';
  }
}

// ─── Auth modal ───────────────────────────────────────────────────────

function openAuthModal(tab = 'login') {
  document.getElementById('auth-modal-overlay').classList.remove('hidden');
  switchTab(tab);
  document.body.style.overflow = 'hidden';
}

function closeAuthModal(e, force = false) {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) {
    if (force || !e || e.target === overlay) {
      overlay.classList.add('hidden');
      document.body.style.overflow = '';
      hideModalError();
    }
  }
}

function switchTab(tab) {
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const modalTitle = document.getElementById('modal-title');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabSignup.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'true');
    tabSignup.setAttribute('aria-selected', 'false');
    modalTitle.textContent = 'Welcome back';
  } else {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    tabLogin.classList.remove('active');
    tabSignup.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'false');
    tabSignup.setAttribute('aria-selected', 'true');
    modalTitle.textContent = 'Create your account';
  }
  hideModalError();
}

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideModalError() {
  document.getElementById('modal-error').classList.add('hidden');
}

function setModalLoading(form, loading) {
  const isLogin = form === 'login';
  const btn = document.getElementById(`${form}-submit-btn`);
  const text = document.getElementById(`${form}-btn-text`);
  const spinner = document.getElementById(`${form}-spinner`);
  btn.disabled = loading;
  text.textContent = loading ? (isLogin ? 'Logging in...' : 'Creating account...') : (isLogin ? 'Login' : 'Create Account');
  spinner.classList.toggle('hidden', !loading);
}

// Login form handler
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideModalError();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showModalError('Please fill in all fields.');

  setModalLoading('login', true);
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    saveAuth(data.user, data.tokens);
    updateAuthUI();
    document.getElementById('auth-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    showToast('✅', `Welcome back, ${data.user.displayName || 'there'}!`);
  } catch (err) {
    showModalError(err.message);
  } finally {
    setModalLoading('login', false);
  }
});

// Signup form handler
document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideModalError();
  const displayName = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!email || !password) return showModalError('Please fill in all required fields.');

  setModalLoading('signup', true);
  try {
    // Register
    const regRes = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
    const regData = await regRes.json();
    if (!regRes.ok) throw new Error(regData.error || 'Registration failed');

    // Auto-login after register
    const loginRes = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) throw new Error('Registration succeeded — please log in.');
    saveAuth(loginData.user, loginData.tokens);
    updateAuthUI();
    document.getElementById('auth-modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    showToast('🎉', 'Account created! Welcome to Quizmefy.');
  } catch (err) {
    showModalError(err.message);
  } finally {
    setModalLoading('signup', false);
  }
});

// Password visibility toggle
function togglePassword(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.textContent = isPassword ? '🙈' : '👁';
}

// Password strength indicator
document.getElementById('signup-password').addEventListener('input', (e) => {
  const val = e.target.value;
  const el = document.getElementById('password-strength');
  if (!val) { el.textContent = ''; return; }
  let strength = 0;
  if (val.length >= 8) strength++;
  if (/[A-Z]/.test(val)) strength++;
  if (/[0-9]/.test(val)) strength++;
  if (/[^a-zA-Z0-9]/.test(val)) strength++;

  const labels = ['', '⚠️ Weak', '🔸 Fair', '✅ Strong', '💪 Very strong'];
  const classes = ['', 'strength-weak', 'strength-ok', 'strength-strong', 'strength-strong'];
  el.textContent = labels[strength];
  el.className = `password-strength ${classes[strength]}`;
});

// Logout
async function logout() {
  if (state.refreshToken) {
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      });
    } catch (_) {}
  }
  clearAuth();
  updateAuthUI();
  showToast('👋', 'Logged out successfully');
}

// ─── Advanced toggle ──────────────────────────────────────────────────

function toggleAdvanced() {
  state.advancedOpen = !state.advancedOpen;
  const content = document.getElementById('advanced-content');
  const icon = document.getElementById('toggle-icon');
  const toggle = document.getElementById('advanced-toggle');
  content.classList.toggle('hidden', !state.advancedOpen);
  content.setAttribute('aria-hidden', String(!state.advancedOpen));
  toggle.setAttribute('aria-expanded', String(state.advancedOpen));
  icon.classList.toggle('rotated', state.advancedOpen);
}

// Character counter
document.getElementById('custom-instructions').addEventListener('input', (e) => {
  document.getElementById('char-count').textContent = `${e.target.value.length} / 500`;
});

// ─── Number control ───────────────────────────────────────────────────

function adjustQuestions(delta) {
  const input = document.getElementById('num-questions');
  const current = parseInt(input.value || '5');
  const newVal = Math.max(1, Math.min(20, current + delta));
  input.value = newVal;
}

function scrollToGenerator() {
  const el = document.getElementById('generator');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      const input = document.getElementById('topic-input');
      if (input) input.focus();
    }, 400);
  }
}

// ─── Quiz Generation ──────────────────────────────────────────────────

document.getElementById('quiz-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.isGenerating) return;

  const topic = document.getElementById('topic-input').value.trim();
  if (!topic) {
    document.getElementById('topic-input').focus();
    showToast('⚠️', 'Please enter a topic first');
    return;
  }

  const difficulty = document.getElementById('difficulty-select').value;
  const numQuestions = parseInt(document.getElementById('num-questions').value || '5');
  const customInstructions = document.getElementById('custom-instructions').value.trim();

  setGenerating(true);

  try {
    const res = await apiFetch('/quiz/generate', {
      method: 'POST',
      body: JSON.stringify({
        topic,
        difficulty,
        numQuestions,
        ...(customInstructions && { customInstructions }),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    state.currentQuiz = data.quiz;
    state.currentQuestions = data.quiz.questions;
    state.quizId = data.quizId;
    state.answers = {};
    state.score = 0;
    state.currentQuestionIndex = 0;

    renderQuiz(data);
    document.getElementById('result-section').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    const cacheMsg = data.cacheHit ? '⚡ Served from cache!' : `✨ Quiz generated in ${data.latencyMs}ms`;
    showToast(data.cacheHit ? '⚡' : '✨', cacheMsg);
  } catch (err) {
    showToast('❌', err.message || 'Failed to generate quiz. Please try again.');
  } finally {
    setGenerating(false);
  }
});

function setGenerating(loading) {
  state.isGenerating = loading;
  const btn = document.getElementById('generate-btn');
  const text = document.getElementById('generate-btn-text');
  const spinner = document.getElementById('generate-spinner');
  const icon = document.getElementById('generate-btn-icon');

  btn.disabled = loading;
  text.textContent = loading ? 'Generating...' : 'Generate Quiz';
  spinner.classList.toggle('hidden', !loading);
  icon.classList.toggle('hidden', loading);
}

// ─── Quiz rendering ───────────────────────────────────────────────────

function renderQuiz(data) {
  const quiz = data.quiz;
  const questions = quiz.questions;

  // Header
  document.getElementById('quiz-title').textContent = quiz.title;
  document.getElementById('quiz-description').textContent = quiz.description || '';
  document.getElementById('quiz-difficulty-tag').textContent = getDifficultyLabel(data.quiz);
  document.getElementById('quiz-questions-tag').textContent = `${questions.length} Questions`;

  const cacheTag = document.getElementById('quiz-cache-tag');
  cacheTag.classList.toggle('hidden', !data.cacheHit);

  const latencyEl = document.getElementById('quiz-latency');
  latencyEl.textContent = data.cacheHit ? `⚡ ${data.latencyMs}ms` : `${data.latencyMs}ms`;

  // Questions
  const container = document.getElementById('questions-container');
  container.innerHTML = '';

  questions.forEach((q, i) => {
    const card = createQuestionCard(q, i, questions.length);
    container.appendChild(card);
  });

  // Progress
  updateProgress();

  // Hide complete
  document.getElementById('quiz-complete').classList.add('hidden');
}

function getDifficultyLabel(quiz) {
  if (!state.currentQuestions[0]) return 'Medium';
  const d = document.getElementById('difficulty-select').value;
  const labels = { EASY: '🟢 Easy', MEDIUM: '🟡 Medium', HARD: '🔴 Hard', EXPERT: '⚡ Expert' };
  return labels[d] || d;
}

function createQuestionCard(q, index, total) {
  const card = document.createElement('article');
  card.className = 'question-card glass-card';
  card.id = `question-card-${index}`;
  card.setAttribute('aria-label', `Question ${index + 1} of ${total}`);
  card.setAttribute('data-question-index', index);

  const optionsHTML = q.options.map(opt => `
    <li>
      <button
        class="q-option"
        id="option-${index}-${opt.id}"
        data-question-index="${index}"
        data-option-id="${opt.id}"
        aria-label="Option ${opt.id}: ${opt.text}"
        onclick="selectAnswer(${index}, '${opt.id}')"
      >
        <span class="option-letter" aria-hidden="true">${opt.id}</span>
        <span>${escapeHtml(opt.text)}</span>
      </button>
    </li>
  `).join('');

  card.innerHTML = `
    <div class="q-number" aria-label="Question ${index + 1}">Question ${index + 1}</div>
    <p class="q-text" id="q-text-${index}">${escapeHtml(q.text)}</p>
    <ul class="q-options" role="group" aria-label="Answer options for question ${index + 1}">
      ${optionsHTML}
    </ul>
    <div class="q-explanation" id="explanation-${index}" role="region" aria-label="Explanation" aria-live="polite">
      <div class="explanation-label">💡 Explanation</div>
      <div id="explanation-text-${index}"></div>
    </div>
  `;

  return card;
}

// ─── Answer selection ─────────────────────────────────────────────────

function selectAnswer(questionIndex, optionId) {
  if (state.answers[questionIndex] !== undefined) return; // Already answered

  const question = state.currentQuestions[questionIndex];
  const isCorrect = optionId === question.correctAnswer;

  state.answers[questionIndex] = optionId;
  if (isCorrect) state.score++;

  // Disable all options for this question
  question.options.forEach(opt => {
    const btn = document.getElementById(`option-${questionIndex}-${opt.id}`);
    if (btn) btn.disabled = true;
  });

  // Mark correct and wrong options
  question.options.forEach(opt => {
    const btn = document.getElementById(`option-${questionIndex}-${opt.id}`);
    if (!btn) return;
    if (opt.id === question.correctAnswer) {
      btn.classList.add('correct');
    } else if (opt.id === optionId && !isCorrect) {
      btn.classList.add('wrong');
    }
  });

  // Mark selected
  const selectedBtn = document.getElementById(`option-${questionIndex}-${optionId}`);
  if (selectedBtn && !isCorrect) selectedBtn.classList.add('selected');

  // Show explanation
  if (question.explanation) {
    const expEl = document.getElementById(`explanation-${questionIndex}`);
    const expText = document.getElementById(`explanation-text-${questionIndex}`);
    if (expEl && expText) {
      expText.textContent = question.explanation;
      expEl.classList.add('visible');
    }
  }

  // Update progress
  updateProgress();

  // Check if quiz complete
  const totalAnswered = Object.keys(state.answers).length;
  if (totalAnswered === state.currentQuestions.length) {
    setTimeout(() => showQuizComplete(), 600);
  }
}

// ─── Progress ─────────────────────────────────────────────────────────

function updateProgress() {
  const total = state.currentQuestions.length;
  const answered = Object.keys(state.answers).length;
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  document.getElementById('progress-text').textContent = `${answered} of ${total} answered`;
  document.getElementById('score-text').textContent = `Score: ${state.score}/${answered || 0}`;
  const fill = document.getElementById('progress-fill');
  if (fill) {
    fill.style.width = `${pct}%`;
    document.getElementById('progress-bar-wrapper').setAttribute('aria-valuenow', pct);
  }
}

// ─── Quiz complete ────────────────────────────────────────────────────

function showQuizComplete() {
  const total = state.currentQuestions.length;
  const pct = Math.round((state.score / total) * 100);

  document.getElementById('quiz-complete').classList.remove('hidden');
  document.getElementById('quiz-complete').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Score ring animation (SVG stroke-dashoffset)
  const ring = document.getElementById('ring-progress');
  if (ring) {
    const circumference = 314;
    const offset = circumference - (pct / 100) * circumference;
    setTimeout(() => { ring.style.strokeDashoffset = offset; }, 100);
  }

  document.getElementById('score-percent').textContent = `${pct}%`;

  // Message based on score
  const messages = [
    { min: 90, icon: '🏆', title: 'Outstanding!',  msg: "You're a master of this topic. Truly impressive!" },
    { min: 70, icon: '🎉', title: 'Great Job!',     msg: 'Solid performance — you clearly know your stuff!' },
    { min: 50, icon: '📚', title: 'Good Effort!',   msg: 'A decent score. Review the explanations to level up.' },
    { min: 0,  icon: '💪', title: 'Keep Going!',    msg: "Every expert was once a beginner. Try again!" },
  ];

  const result = messages.find(m => pct >= m.min);
  document.getElementById('complete-icon').textContent = result.icon;
  document.getElementById('complete-title').textContent = result.title;
  document.getElementById('complete-message').textContent = result.msg;

  showToast(result.icon, `You scored ${state.score}/${total} (${pct}%)`);
}

// ─── Quiz controls ────────────────────────────────────────────────────

function retakeQuiz() {
  if (!state.currentQuiz) return;
  state.answers = {};
  state.score = 0;

  // Re-render questions (reset state)
  const fakeData = {
    quiz: state.currentQuiz,
    cacheHit: false,
    latencyMs: 0,
    quizId: state.quizId,
  };
  renderQuiz(fakeData);
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetQuiz() {
  state.currentQuiz = null;
  state.currentQuestions = [];
  state.answers = {};
  state.score = 0;
  state.quizId = null;

  document.getElementById('result-section').classList.add('hidden');
  document.getElementById('quiz-form').reset();
  document.getElementById('num-questions').value = 5;
  document.getElementById('char-count').textContent = '0 / 500';

  scrollToGenerator();
}

async function shareQuiz() {
  const url = state.quizId
    ? `${window.location.origin}?quiz=${state.quizId}`
    : window.location.href;

  try {
    if (navigator.share) {
      await navigator.share({ title: state.currentQuiz?.title || 'Quizmefy Quiz', url });
    } else {
      await navigator.clipboard.writeText(url);
      showToast('📋', 'Link copied to clipboard!');
    }
  } catch (_) {
    showToast('📋', 'Copy this URL to share: ' + url.slice(0, 40) + '...');
  }
}

// ─── Toast notifications ──────────────────────────────────────────────

let toastTimer = null;

function showToast(icon, message, durationMs = 3500) {
  const toast = document.getElementById('toast');
  const toastIcon = document.getElementById('toast-icon');
  const toastMsg = document.getElementById('toast-msg');

  clearTimeout(toastTimer);
  toastIcon.textContent = icon;
  toastMsg.textContent = message;
  toast.classList.remove('hidden');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, durationMs);
}

// ─── Utility ──────────────────────────────────────────────────────────

function escapeHtml(text) {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAuthModal(null, true);
  }
});

// ─── Deep link: load quiz from URL param ─────────────────────────────

async function loadQuizFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const quizId = params.get('quiz');
  if (!quizId) return;

  try {
    const res = await apiFetch(`/quiz/${quizId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.quiz) return;

    const quiz = data.quiz;
    state.currentQuiz = quiz;
    state.currentQuestions = quiz.questions;
    state.quizId = quizId;
    state.answers = {};
    state.score = 0;

    renderQuiz({ quiz, cacheHit: false, latencyMs: 0, quizId });
    document.getElementById('result-section').classList.remove('hidden');
    document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
  } catch (_) {}
}

// ─── Initialize ───────────────────────────────────────────────────────

function init() {
  updateAuthUI();
  loadQuizFromUrl();

  // Try it free button click handler
  const heroTryBtn = document.getElementById('hero-try-btn');
  if (heroTryBtn) {
    heroTryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToGenerator();
    });
  }

  // Modal close button click handler
  const modalCloseBtn = document.getElementById('modal-close-btn');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAuthModal(null, true);
    });
  }

  // Navbar scroll shadow
  window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    navbar.style.boxShadow = window.scrollY > 20
      ? '0 4px 32px hsla(225,25%,0%,0.5)'
      : '';
  }, { passive: true });

  // Add SVG gradient defs dynamically for score ring
  const svg = document.querySelector('.score-ring');
  if (svg) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="hsl(265,85%,65%)"/>
        <stop offset="100%" stop-color="hsl(210,100%,65%)"/>
      </linearGradient>
    `;
    svg.prepend(defs);
  }
}

document.addEventListener('DOMContentLoaded', init);
