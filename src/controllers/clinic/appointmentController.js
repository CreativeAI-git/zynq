import { handleError, handleSuccess } from '../../utils/responseHandler.js';
import * as appointmentModel from '../../models/appointment.js';
import dayjs from 'dayjs';
import { isEmpty } from '../../utils/user_helper.js';
import { asyncHandler } from "../../utils/responseHandler.js"
const APP_URL = process.env.APP_URL;

export const getMyAppointmentsClinic = asyncHandler(async (req, res) => {
    await appointmentModel.updateMissedAppointmentStatusModel();
    const clinicId = req.user.clinicData.clinic_id;
    const now = dayjs.utc();

    const appointments = await appointmentModel.getAppointmentsByClinicId(clinicId);

    if (isEmpty(appointments)) {
        return handleError(res, 404, "en", "APPOINTMENTS_NOT_FOUND");
    }

    const result = appointments.map((app) => {
        if (app.profile_image && !app.profile_image.startsWith('http')) {
            app.profile_image = `${APP_URL}${app.profile_image}`;
        }

        const startUTC = app.start_time ? dayjs.utc(app.start_time) : null;
        const endUTC = app.end_time ? dayjs.utc(app.end_time) : null;

        const videoCallOn = (
            app.type === 'Video Call' &&
            ['Scheduled', 'Rescheduled', 'Ongoing'].includes(app.status) &&
            startUTC?.isValid() &&
            endUTC?.isValid() &&
            now.isAfter(startUTC) &&
            now.isBefore(endUTC)
        );

        return {
            ...app,
            start_time: startUTC ? startUTC.toISOString() : null,
            end_time: endUTC ? endUTC.toISOString() : null,
            videoCallOn
        };
    });


    return handleSuccess(res, 200, "en", "APPOINTMENTS_FETCHED_SUCCESSFULLY", result);
});