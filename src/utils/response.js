export const successResponse = (res, data = {}, message = 'Operation completed successfully', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    data,
    message,
  });
};

export const errorResponse = (res, message = 'Something went wrong', statusCode = 500, errors = []) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors: Array.isArray(errors) ? errors : [errors],
  });
};
