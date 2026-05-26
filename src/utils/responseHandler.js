import { getMessage } from './getMessage.js';

export const handleError = (res, statusCode, lang = 'en', messageKey) => {
  const payload = {
    success: false,
    status: statusCode,
    message: getMessage(messageKey, lang)
  };

  if (process.env.NODE_ENV !== "production") {
    payload.error_key = messageKey;
  }

  return res.status(statusCode).send(payload);
};

export const handleSuccess = (res, statusCode, lang = 'en', messageKey, ...data) => {
  return res.status(200).json({
    success: true,
    status: statusCode,
    message: getMessage(messageKey, lang),
    data: data.length > 0 ? data[0] : undefined,
  });
};

export const joiErrorHandle = (res, error) => {
  return res.status(200).send({
    success: false,
    status: 400,
    message: error.details[0].message
  });
};

 
export const asyncHandler = (requestHandler) => {
  return async (req, res, next) => {
    try {
      await requestHandler(req, res, next);
    } catch (err) {
      console.error("Unhandled error:", err);
 
      return handleError(res, 500, "en", "INTERNAL_SERVER_ERROR");
    }
  };
};
