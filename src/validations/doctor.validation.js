import joi from "joi";
import {
  idArrayValidation,
  stringValidation,
  numberValidation,
  orderValidation,
  ratingValidation,
} from "../utils/joi.util.js";

export const getSingleDoctorSchema = joi.object({
  doctor_id: stringValidation,
  clinic_id: stringValidation,
  treatment_search: stringValidation.optional().allow("", null),
});

export const getSingleDoctorRatingsSchema = joi.object({
  doctor_id: stringValidation,
});

export const getAllDoctorsSchema = joi.object({
  filters: joi.object({
    treatment_ids: idArrayValidation.optional(),
    skin_condition_ids: idArrayValidation.optional(),
    aesthetic_device_ids: idArrayValidation.optional(),
    skin_type_ids: idArrayValidation.optional(),
    surgery_ids: idArrayValidation.optional(),
    concern_ids: idArrayValidation.optional(),
    search: stringValidation.optional(),
    debug_search: joi.boolean().optional(),
    distance: joi.object({
      min: numberValidation.min(0),
      max: numberValidation.min(0)
    }).optional(),
    price: joi.object({
      min: numberValidation.min(0),
      max: numberValidation.min(0)
    }).optional(),
    min_rating: ratingValidation.optional(),
  }).optional(),

  sort: joi.object({
    by: joi.string().valid('nearest', 'rating', 'price').default('nearest'),
    order: orderValidation
  }).optional(),
  pagination: joi.object({
    page: numberValidation.min(1).default(1),
    limit: numberValidation.min(1).default(20)
  }).optional()
});

export const requestCallbackSchema = joi.object({
  doctor_id: stringValidation,
})
