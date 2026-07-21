 
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import * as webModels from "../models/web_user.js";
import * as doctorModels from "../models/doctor.js";
import * as clinicModels from "../models/clinic.js";
import { handleError } from "../utils/responseHandler.js";
 
dotenv.config();
 
const WEB_JWT_SECRET = process.env.WEB_JWT_SECRET;
 
export const authenticate = (allowedRoles = []) => {
    return async (req, res, next) => {
        try {
            const authorizationHeader = req.headers['authorization'];
            if (!authorizationHeader) {
                return handleError(res, 401, 'en', "UNAUTH");
            }
 
            const tokenParts = authorizationHeader.split(' ');
            if (tokenParts[0] !== 'Bearer' || tokenParts[1] === 'null' || !tokenParts[1]) {
                return handleError(res, 401, 'en', "UNAUTHMISSINGTOKEN");
            }

            const token = tokenParts[1];
            let decodedToken;
            
            try {
                decodedToken = jwt.verify(token, WEB_JWT_SECRET);
            } catch (err) {
                return handleError(res, 401, 'en', "UNAUTH");
            }
 
 
            let [user] = await webModels.get_web_user_by_id(decodedToken.web_user_id)
 
            if (!user) {
                return handleError(res, 401, 'en', "USER_NOT_FOUND");
            }
 
            const userRole = user.role_name;
 
            if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
                return handleError(res, 401, 'en', "ACCESS_DENIED");
            }
            if (userRole === 'DOCTOR') {
                const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(user.id);
                if (doctorData) {
                    if (doctorData.is_active === 0) {
                        return handleError(res, 401, userLanguage, "DOCTOR_DEACTIVATED");
                    }
                    user.doctorData = doctorData
                } else {
                    return handleError(res, 401, 'en', "DOCTOR_NOT_FOUND");
                }
            }
 
            if (userRole === 'CLINIC') {
                const [clinicData] = await clinicModels.get_clinic_by_zynq_user_id(user.id);
                if (clinicData) {
                    user.clinicData = clinicData
                } else {
                    return handleError(res, 401, 'en', "CLINIC_NOT_FOUND");
                }
            }
 
            if (userRole === 'SOLO_DOCTOR') {
                const [clinicData] = await clinicModels.get_clinic_by_zynq_user_id(user.id);
               
                const [doctorData] = await doctorModels.get_doctor_by_zynquser_id(user.id);
             
                if (clinicData && doctorData) {
                    if (doctorData.is_active === 0) {
                        return handleError(res, 401, userLanguage, "DOCTOR_DEACTIVATED");
                    }
                    user.clinicData = clinicData
                    user.doctorData = doctorData
                } else {
                    return handleError(res, 401, 'en', "CLINIC_NOT_FOUND");
                }
            }

            req.user = user;
            req.user.role = userRole;
            next();
 
        } catch (error) {
            console.error("Authentication error:", error);
            return handleError(res, 401, 'en', "INTERNAL_SERVER_ERROR");
        }
    };
};
 