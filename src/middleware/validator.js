import { errorResponse } from '../utils/response.js';

export const validateRequest = (schema, property = 'body') => {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req[property]);
      req[property] = validated;
      next();
    } catch (err) {
      if (err.errors) {
        const errorList = err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }));
        return errorResponse(res, 'Validation failed', 400, errorList);
      }
      return errorResponse(res, 'Invalid request data', 400, [err.message]);
    }
  };
};
