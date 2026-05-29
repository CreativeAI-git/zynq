import joi from "joi";

export const saveScanSchema = joi
  .object({
    status: joi.number().required(),
    data: joi
      .object({
        task_status: joi.string().allow("", null).optional(),
        results: joi.object().allow(null).optional(),
      })
      .required()
      .unknown(true),
  })
  .unknown(true);

export const getScanResultsSchema = joi.object({
  scan_id: joi.string().uuid().optional(),
});
