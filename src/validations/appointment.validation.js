import joi from "joi";
import {
  stringValidation,
  dateValidation,
  numberValidation,
  emailValidation,
} from "../utils/joi.util.js";

export const rescheduleAppointmentSchema = joi.object({
  appointment_id: stringValidation,
  doctor_id: stringValidation,
  start_time: dateValidation,
  end_time: dateValidation
});

export const rateAppointmentSchema = joi.object({
  appointment_id: stringValidation,
  rating: numberValidation.min(1).max(5),
  review: stringValidation.optional()
});

export const getSinglePatientRecordSchema = joi.object({
  patient_id: stringValidation
})

export const updateRatingStatusSchema = joi.object({
  appointment_rating_id: stringValidation,
  approval_status: stringValidation.valid('APPROVED', 'REJECTED')
})

export const sendReportToChatSchema = joi.object({
  chat_id: stringValidation,
  // report_id: stringValidation
  report_id: stringValidation.optional().allow(null, "")
})

export const contactUsSchema = joi.object({
  email: emailValidation,
  first_name: stringValidation,
  last_name: stringValidation,
  phone_number: stringValidation,
  message: stringValidation,
})

export const guestLoginSchema = joi.object({
  device_id: stringValidation,
  data: stringValidation,
  language: stringValidation
})

export const getGuestFaceScanSchema = joi.object({
  device_id: stringValidation,
  language: stringValidation.valid("en", "sv")
})

export const getDraftAppointmentsSchema = joi.object({
  doctor_id: stringValidation
})

export const deleteDraftAppointmentSchema = joi.object({
  appointment_id: stringValidation
})