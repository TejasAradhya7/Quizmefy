import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Zod request validation middleware factory.
 * Validates req.body, req.query, or req.params against a Zod schema.
 */
export function validate(
  schema: ZodSchema,
  target: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = result.error.flatten();
      res.status(400).json({
        error: 'Validation failed',
        details: errors.fieldErrors,
      });
      return;
    }

    // Replace with validated + typed data (coercion applied)
    req[target] = result.data;
    next();
  };
}

export { ZodError };
