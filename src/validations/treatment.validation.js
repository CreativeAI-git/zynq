import joi from "joi";
import {
  booleanValidation,
  emailValidation,
  idArrayValidation,
  numberValidation,
  stringValidation,
} from "../utils/joi.util.js";


export const getTreatmentsByConcernSchema = joi.object({
  concern_id: stringValidation,
});

export const getTreatmentsByConcersSchema = joi.object({
  concern_ids: idArrayValidation,
  filters: joi.object({
    search: stringValidation.optional(),
    treatment_ids: idArrayValidation.optional(),
    recommended: booleanValidation.optional()
  }).optional()
})
export const getTipsByConcernsSchema = joi.object({
  concern_ids: idArrayValidation,
})

export const getTreatmentsSchema = joi.object({
  treatment_ids: idArrayValidation.optional(),
  doctor_id: stringValidation.optional(),
});

export const sendFaceResultToEmailSchema = joi.object({
  face_scan_result_id: stringValidation.optional().allow("", null),
})

export const getTreatmentFiltersSchema = joi.object({
  filters: joi.object({
    search: stringValidation.optional(),
    treatment_ids: idArrayValidation.optional(),
    recommended: booleanValidation.optional()
  }).optional()
}).optional()

export const addAppointmentDraftSchema = joi.object({
  user_id: stringValidation,
  clinic_id: stringValidation,
  report_id: stringValidation,
  origin_appointment_id: stringValidation,
  discount_type: stringValidation.valid('PERCENTAGE', 'SEK'),
  discount_value: numberValidation.min(0),
  treatments: joi.array().items(joi.object({
    treatment_id: stringValidation,
    price: numberValidation.min(0),
    sub_treatments: joi.array().items(joi.object({
      sub_treatment_id: stringValidation,
      price: numberValidation.min(0)
    }))
  }))
})

export const addEditTreatmentSchema = joi.object({
  treatment_id: stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  // swedish: stringValidation,
  classification_type: stringValidation.valid('Medical', 'Non-Medical'),
  benefits_ids: joi.array().items(joi.string().uuid()).allow(null).optional(),
  // benefits_sv: stringValidation,
  description_en: stringValidation,
  // description_sv: stringValidation,
  // source: stringValidation.valid("old", "new"),
  embeddings: joi.array().items(numberValidation).allow(null).optional(),
  is_device: booleanValidation,
  concerns_ids: joi.array().items(joi.string().uuid()).allow(null).optional(),
  sub_treatments: idArrayValidation,
  device_ids: joi.array().items(joi.string().uuid()).allow(null).optional(),
  like_wise_terms_ids: joi.array().items(joi.string().uuid()).allow(null).optional(),
  primary_tags: joi.array().items(joi.string()).optional(),
  concerns_tags: joi.array().items(joi.string()).optional(),
  benefits_tags: joi.array().items(joi.string()).optional(),
  synonyms_tags: joi.array().items(joi.string()).optional(),
})

export const addEditSubtreatmentSchema = joi.object({
  treatment_id: stringValidation.optional(),
  sub_treatment_id: stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional()
})

export const addEditSubtreatmentMasterSchema = joi.object({
  sub_treatment_id: stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional()
})

export const deleteTreatmentSchema = joi.object({
  treatment_id: stringValidation,
})

export const deleteSubTreatmentSchema = joi.object({
  sub_treatment_id: stringValidation,
})

export const updateTreatmentApprovalStatusSchema = joi.object({
  treatment_id: stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
})

export const addEditConcernSchema = joi.object({
  concern_id: stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional(),
});

export const deleteConcernSchema = joi.object({
  concern_id: stringValidation,
})

export const updateConcernApprovalStatusSchema = joi.object({
  concern_id: stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
});


export const addEditLikeWiseSchema = joi.object({
  like_wise_term_id : stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional(),
});

export const deleteLikeWiseSchema = joi.object({
  like_wise_term_id : stringValidation,
});

export const updateLikeWiseApprovalStatusSchema = joi.object({
  like_wise_term_id : stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
});


export const addEditBenefitsSchema = joi.object({
  benefit_id : stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional(),
});

export const deleteBenefitsSchema = joi.object({
  benefit_id : stringValidation,
});

export const updateBenefitsApprovalStatusSchema = joi.object({
  benefit_id : stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
});

export const addEditDevicesSchema = joi.object({
  device_id : stringValidation.optional(),
  language: joi.string().valid("en", "sv").optional().allow("", null),
  name: stringValidation,
  swedish: stringValidation.optional(),
  primary_tags: joi.array().items(joi.string()).optional(),
  concerns_tags: joi.array().items(joi.string()).optional(),
  benefits_tags: joi.array().items(joi.string()).optional(),
  synonyms_tags: joi.array().items(joi.string()).optional(),
});

export const deleteDevicesSchema = joi.object({
  device_id : stringValidation,
});

export const updateDevicesApprovalStatusSchema = joi.object({
  device_id : stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
});
