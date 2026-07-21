import express from 'express';
import { upload } from '../services/multer.js';
import { authenticateAdmin } from "../middleware/auth.js";

//==================================== Import Controllers ==============================
import * as authControllersClinic from "../controllers/clinic/authController.js";
import * as authControllers from "../controllers/admin/authController.js"
import * as dashboardControllers from "../controllers/admin/dashboardController.js";
import * as userControllers from "../controllers/admin/userController.js";
import * as clinicControllers from "../controllers/admin/clinicController.js";
import * as doctorControllers from "../controllers/admin/doctorController.js";
import { deleteExpertController } from "../controllers/admin/doctorController.js";
import * as productControllers from "../controllers/admin/productController.js";
import * as supportControllers from "../controllers/admin/supportController.js";
import { getLegalDocuments, updateLegalDocuments } from '../controllers/api/legalController.js';
import { updateLegalDocumentsSchema, updateUserApprovalStatusSchema, updateZynqUserApprovalStatusSchema } from '../validations/legal.validation.js';
import { validate } from '../middleware/validation.middleware.js';
import { updateAdminCommissionRatesSchema } from '../validations/commission.validation.js';
import { deleteNotifications, deleteSingleNotification, getNotifications } from '../controllers/api/notificationController.js';
import { addWalletAmountSchema, getPaymentHistorySchema, getSinglePurchasedProductSchema } from '../validations/payment.validation.js';
import { deleteSingleNotificationSchema } from '../validations/notification.validation.js';
import { get_treatments } from '../controllers/api/faceScanController.js';
import { updateRatingStatusSchema } from '../validations/appointment.validation.js';
import { addEditFAQCategorySchema, addEditFAQSchema, deleteFAQCategorySchema, getAllFAQSchema, getSingleFAQCategorySchema, getSingleFAQSchema } from '../validations/faq.validation.js';
import { addEditFAQ, addEditFAQCategory, deleteFAQ, deleteFAQCategory, getAllFAQCategories, getAllFAQs, getSingleFAQ, getSingleFAQCategory } from '../controllers/api/FAQController.js';
import { getContactUs } from '../controllers/api/authController.js';
import { updateProductApprovalStatusSchema } from '../validations/product.validation.js';
import { addEditConcernSchema, addEditTreatmentSchema, addEditSubtreatmentSchema, deleteConcernSchema, deleteTreatmentSchema, updateConcernApprovalStatusSchema, updateTreatmentApprovalStatusSchema, deleteSubTreatmentSchema, addEditSubtreatmentMasterSchema, addEditLikeWiseSchema, updateLikeWiseApprovalStatusSchema, deleteLikeWiseSchema, addEditDevicesSchema, deleteDevicesSchema, updateDevicesApprovalStatusSchema, addEditBenefitsSchema, deleteBenefitsSchema, updateBenefitsApprovalStatusSchema } from '../validations/treatment.validation.js';
import { get_all_concerns, addEditConcern, getAllTreatments, getAllTreatmentById, addEditTreatment, addEditSubtreatment, deleteConcern, deleteTreatment, updateConcernApprovalStatus, updateTreatmentApprovalStatus, deleteSubTreatment, addEditSubTreatmentMaster, deleteSubTreatmentMaster, getAllSubTreatmentMasters, cloneTreatment, addEditLikeWiseTerms, deleteLikeWiseTerms, updateLikeWiseTermsApprovalStatus, addEditBenefit, addEditDevice, deleteDevice, updateDeviceApprovalStatus, deleteBenefit, updateBenefitApprovalStatus, getAllLikeWiseTerms, getAllDevices, getAllBenefits } from '../controllers/api/treatmentController.js';
import { uploadDynamicClinicFiles } from '../services/clinic_multer.js';
import { updateClinicAdmin } from '../controllers/clinic/authController.js';
import * as clinicModels from '../models/clinic.js';
import { uploadCertificationFieldsTo, uploadFileTo } from '../services/doctor_multer.js';
import { updateDoctorAdminController } from '../controllers/doctor/profileController.js';
import { deleteClinicImageSchema } from '../validations/clinic.validation.js';
import { uploadVariousFieldsForSoloDoctorDynamic } from '../services/dynamic_uploaded_multer.js';

const router = express.Router();

//==================================== Authentication ==============================
router.post('/login', authControllers.login);
router.post('/forgot-password', authControllers.forgotPassword);
router.get('/reset-password/:token', authControllers.renderResetPasswordPage);
router.post('/reset-password', authControllers.resetPassword);
router.get('/success-change', authControllers.successChange);
router.get('/get-profile', authenticateAdmin, authControllers.profile);
router.post('/update-profile', authenticateAdmin, upload.single('file'), authControllers.updateProfile);
router.post('/change-password', authenticateAdmin, authControllers.changePassword);

//==================================== Location ==============================
router.get('/search-location', authenticateAdmin, authControllers.searchLocation);
router.get("/get-lat-long", authenticateAdmin, authControllers.getLatLong);

//==================================== Dashboard ==============================
router.get('/get-dashboard', authenticateAdmin, dashboardControllers.get_dashboard);

//==================================== User Managment ==============================
router.get('/get-users-managment', authenticateAdmin, userControllers.get_users_managment);
router.post('/update-user-status', authenticateAdmin, userControllers.update_user_status);

//==================================== Clinic Managment ==============================
router.post('/import-clinics-from-CSV', authenticateAdmin, upload.single("file"), clinicControllers.import_clinics_from_CSV);
router.post('/add-clinic-managment', authenticateAdmin, clinicControllers.add_clinic_managment);
router.get('/get-clinic-managment', authenticateAdmin, clinicControllers.get_clinic_managment);
router.get('/get-clinic-list-doctor-onboarding', authenticateAdmin, clinicControllers.getClinicListForDoctorOnboardingController);
router.post('/delete-clinic-management', authenticateAdmin, clinicControllers.delete_clinic_management);
router.post('/send-invitation', authenticateAdmin, clinicControllers.send_invitation);
router.get('/subscribed/:is_subscribed', clinicControllers.subscribed);
router.get('/unsubscribed/:is_unsubscribed', clinicControllers.unsubscribed);

// router.get('/subscribed/:is_subscribed', (req, res) => {

//   const data = `<!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">
//   <title>Coming Soon</title>

//   <!-- Bootstrap 5 -->
//   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

//   <!-- Google Font -->
//   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">

//   <style>
    
//     * {
//   box-sizing: border-box;
//   font-family: 'Inter', sans-serif;
// }

// body {
//   margin: 0;
//   background: #000;
//   color: #fff;
// }
// .ct_logo{
//   margin-bottom: 30px;
// }

// .ct_logo img {
//     filter: invert(1);
//     width: 100%;
//     max-width: 150px;
// }

// /* Main Section */
// .coming-soon {
//   min-height: 100vh;
//   background:
//     radial-gradient(circle at top, rgba(99,102,241,0.25), transparent 40%),
//     radial-gradient(circle at bottom, rgba(236,72,153,0.2), transparent 45%),
//     #000;
// }

// /* Badge */
// .badge-soon {
//   background: linear-gradient(135deg, #6366f1, #ec4899);
//   padding: 8px 18px;
//   border-radius: 50px;
//   font-size: 14px;
//   font-weight: 600;
// }

// /* Text */
// .title {
//   font-size: 60px;
//   font-weight: 700;
// }

// .subtitle {
//   color: #9ca3af;
//   font-size: 16px;
//   max-width: 520px;
//   margin: auto;
// }

// /* Email Box */
// .email-box {
//   display: flex;
//   max-width: 420px;
//   margin: auto;
//   background: #111;
//   border-radius: 12px;
//   overflow: hidden;
//   border: 1px solid #222;
// }

// .email-box input {
//   flex: 1;
//   background: transparent;
//   border: none;
//   padding: 14px;
//   color: #fff;
//   outline: none;
// }

// .email-box input::placeholder {
//   color: #6b7280;
// }

// .email-box button {
//   background: linear-gradient(135deg, #6366f1, #ec4899);
//   border: none;
//   padding: 0 22px;
//   color: #fff;
//   font-weight: 600;
//   cursor: pointer;
// }

// .email-box button:hover {
//   opacity: 0.9;
// }

// /* Footer */
// .small-text {
//   font-size: 13px;
//   color: #6b7280;
// }

// /* Responsive */
// @media (max-width: 576px) {
//   .title {
//     font-size: 30px;
//   }
// }

//   </style>
// </head>
// <body>



// <section class="coming-soon d-flex align-items-center justify-content-center">
//   <div class="container text-center">
//     <div class="ct_logo">
//       <img src="https://getzynq.io:4000/logo1.png">
//     </div>


//     <h1 class="title mt-3">Kommer snart</h1>
//     <p class="subtitle mt-3">
//       Vi arbetar hårt för att ge dig en fantastisk upplevelse.<br>
// Håll utkik efter lanseringen.
//     </p>

   

//     <p class="small-text mt-4">
//       © 2026 ZYNQ. Alla rättigheter reserverade.
//     </p>

//   </div>
// </section>

// </body>
// </html>
// `

//   res.send(data);
// });
// router.get('/unsubscribed/:is_unsubscribed', (req, res) => {
//   const data = `<!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">
//   <title>Coming Soon</title>

//   <!-- Bootstrap 5 -->
//   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">

//   <!-- Google Font -->
//   <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">

//   <style>
    
//     * {
//   box-sizing: border-box;
//   font-family: 'Inter', sans-serif;
// }

// body {
//   margin: 0;
//   background: #000;
//   color: #fff;
// }
// .ct_logo{
//   margin-bottom: 30px;
// }

// .ct_logo img {
//     filter: invert(1);
//     width: 100%;
//     max-width: 150px;
// }

// /* Main Section */
// .coming-soon {
//   min-height: 100vh;
//   background:
//     radial-gradient(circle at top, rgba(99,102,241,0.25), transparent 40%),
//     radial-gradient(circle at bottom, rgba(236,72,153,0.2), transparent 45%),
//     #000;
// }

// /* Badge */
// .badge-soon {
//   background: linear-gradient(135deg, #6366f1, #ec4899);
//   padding: 8px 18px;
//   border-radius: 50px;
//   font-size: 14px;
//   font-weight: 600;
// }

// /* Text */
// .title {
//   font-size: 60px;
//   font-weight: 700;
// }

// .subtitle {
//   color: #9ca3af;
//   font-size: 16px;
//   max-width: 520px;
//   margin: auto;
// }

// /* Email Box */
// .email-box {
//   display: flex;
//   max-width: 420px;
//   margin: auto;
//   background: #111;
//   border-radius: 12px;
//   overflow: hidden;
//   border: 1px solid #222;
// }

// .email-box input {
//   flex: 1;
//   background: transparent;
//   border: none;
//   padding: 14px;
//   color: #fff;
//   outline: none;
// }

// .email-box input::placeholder {
//   color: #6b7280;
// }

// .email-box button {
//   background: linear-gradient(135deg, #6366f1, #ec4899);
//   border: none;
//   padding: 0 22px;
//   color: #fff;
//   font-weight: 600;
//   cursor: pointer;
// }

// .email-box button:hover {
//   opacity: 0.9;
// }

// /* Footer */
// .small-text {
//   font-size: 13px;
//   color: #6b7280;
// }

// /* Responsive */
// @media (max-width: 576px) {
//   .title {
//     font-size: 30px;
//   }
// }

//   </style>
// </head>
// <body>



// <section class="coming-soon d-flex align-items-center justify-content-center">
//   <div class="container text-center">
//     <div class="ct_logo">
//       <img src="https://getzynq.io:4000/logo1.png">
//     </div>


//     <h1 class="title mt-3">Kommer snart</h1>
//     <p class="subtitle mt-3">
//       Vi arbetar hårt för att ge dig en fantastisk upplevelse.<br>
// Håll utkik efter lanseringen.
//     </p>

   

//     <p class="small-text mt-4">
//       © 2026 ZYNQ. Alla rättigheter reserverade.
//     </p>

//   </div>
// </section>

// </body>
// </html>
// `

//   res.send(data);
// });

//==================================== Doctor Managment ==============================

router.get('/get-dcotors-managment', authenticateAdmin, doctorControllers.get_doctors_management);
router.get('/get-dcotors-invitation-list', authenticateAdmin, doctorControllers.getDoctorInvitationListController);

//==================================== Product Managment ==============================
router.get('/get-products-managment', authenticateAdmin, productControllers.get_products_managment);
router.get('/get-products-managment/:product_id', authenticateAdmin, productControllers.get_single_products_managment);
router.post('/delete-products-managment', authenticateAdmin, productControllers.delete_products_managment);


//==================================== Support Managment ==============================
router.get('/get-all-support-tickets', authenticateAdmin, supportControllers.get_all_support_tickets);
router.post('/admin-response-to-support-ticket', authenticateAdmin, supportControllers.admin_response_to_support_ticket);

//==================================== Call Logs Managment ==============================

router.get('/call-logs', authenticateAdmin, authControllers.get_all_call_logs);

//==================================== Appointments ==============================

router.get('/getAllappointments', authenticateAdmin, authControllers.get_all_appointments);
router.get('/getAllappointments/:appointment_id', authenticateAdmin, authControllers.get_single_all_appointments);

//==============================Enrollememt ===============================

router.get('/get-all-enrollments', authenticateAdmin, authControllers.get_all_enrollments);


//==============================Wallets ===================================

router.get('/wallets', authenticateAdmin, dashboardControllers.get_wallets);

router.get('/legal', authenticateAdmin, getLegalDocuments);

router.put('/legal', authenticateAdmin, validate(updateLegalDocumentsSchema, "body"), updateLegalDocuments);

router.get('/payments/get-booked-appointments', authenticateAdmin, dashboardControllers.getBookedAppointments);

router.get('/payments/get-purchased-products/:purchase_id', authenticateAdmin, validate(getSinglePurchasedProductSchema, "params"), dashboardControllers.getSinglePurchasedProducts);

router.get('/payments/get-purchased-products', authenticateAdmin, dashboardControllers.getPurchasedProducts);

router.get('/reviews-ratings', authenticateAdmin, dashboardControllers.getAdminReviewsRatings);

router.get('/commission-rates', authenticateAdmin, dashboardControllers.getAdminCommissionRates);

router.put('/commission-rates', authenticateAdmin, validate(updateAdminCommissionRatesSchema, "body"), dashboardControllers.updateAdminCommissionRates);

router.get('/payments/get-payment-history', authenticateAdmin, validate(getPaymentHistorySchema, "query"), dashboardControllers.getPaymentHistory);

router.get('/payments/get-earnings', authenticateAdmin, dashboardControllers.getEarnings);

//=======================================Notifications=============================
router.get('/notifications/get', authenticateAdmin, getNotifications);
router.delete('/notifications/:notification_id', authenticateAdmin, validate(deleteSingleNotificationSchema, "params"), deleteSingleNotification);
router.delete('/notifications', authenticateAdmin, deleteNotifications);

//=======================================Appointment=============================

router.post('/cancelAppointment', authenticateAdmin, authControllers.cancelAppointment);

router.post('/completeRefundToWallet', authenticateAdmin, authControllers.completeRefundToWallet);

router.get('/refundHistory', authenticateAdmin, authControllers.getRefundHistory);

router.get('/getUserAppointments/:user_id', authenticateAdmin, authControllers.getUserAppointmentOfUser);

router.post('/payments/add-wallet-amount', authenticateAdmin, validate(addWalletAmountSchema, "body"), dashboardControllers.addWalletAmount);

router.get('/get_treatments', get_treatments);

router.post('/update-rating-status', authenticateAdmin, validate(updateRatingStatusSchema, 'body'), dashboardControllers.updateRatingStatus)

//=======================================FAQs===============================================

router.post('/faq', authenticateAdmin, validate(addEditFAQSchema, 'body'), addEditFAQ);
router.post('/faq/get-all-faqs', authenticateAdmin, validate(getAllFAQSchema, "body"), getAllFAQs);
router.get('/faq/:faq_id', authenticateAdmin, validate(getSingleFAQSchema, 'params'), getSingleFAQ);
router.delete('/faq/:faq_id', authenticateAdmin, validate(getSingleFAQSchema, 'params'), deleteFAQ);

//=======================================FAQ Categories======================================

router.get('/faq-categories', authenticateAdmin, getAllFAQCategories);
router.get('/faq-categories/:faq_category_id', authenticateAdmin, validate(getSingleFAQCategorySchema, 'params'), getSingleFAQCategory);
router.post('/faq-categories', authenticateAdmin, validate(addEditFAQCategorySchema, 'body'), addEditFAQCategory);
router.delete('/faq-categories/:faq_category_id', authenticateAdmin, validate(deleteFAQCategorySchema, 'params'), deleteFAQCategory);

router.get('/contact-us', authenticateAdmin, getContactUs);

router.patch('/user/approval-status', authenticateAdmin, validate(updateUserApprovalStatusSchema, 'body'), userControllers.updateUserApprovalStatus);

router.patch('/zynq-user/approval-status', authenticateAdmin, validate(updateZynqUserApprovalStatusSchema, 'body'), userControllers.updateZynqUserApprovalStatus);

router.patch('/product/approval-status', authenticateAdmin, validate(updateProductApprovalStatusSchema, 'body'), productControllers.updateProductApprovalStatus);

router.get('/get-all-treatments', authenticateAdmin, getAllTreatments);

router.get('/get-all-sub-treatments', authenticateAdmin, getAllSubTreatmentMasters);

router.get('/get-treatment-by-id', authenticateAdmin, getAllTreatmentById);

router.post('/treatment', authenticateAdmin, validate(addEditTreatmentSchema, 'body'), addEditTreatment);

router.delete('/treatment/:treatment_id', authenticateAdmin, validate(deleteTreatmentSchema, 'params'), deleteTreatment);
router.delete('/sub_treatment/:sub_treatment_id', authenticateAdmin, validate(deleteSubTreatmentSchema, 'params'), deleteSubTreatment);

router.delete('/sub-treatment-master/:sub_treatment_id', authenticateAdmin, validate(deleteSubTreatmentSchema, 'params'), deleteSubTreatmentMaster);

router.patch('/treatment/approval-status', authenticateAdmin, validate(updateTreatmentApprovalStatusSchema, 'body'), updateTreatmentApprovalStatus);

router.post('/sub-treatment', authenticateAdmin, validate(addEditSubtreatmentSchema, 'body'), addEditSubtreatment);

router.post('/sub-treatment-master', authenticateAdmin, validate(addEditSubtreatmentMasterSchema, 'body'), addEditSubTreatmentMaster);

router.get('/get-allconcerns', authenticateAdmin, get_all_concerns);

router.post('/concern', authenticateAdmin, validate(addEditConcernSchema, 'body'), addEditConcern);

router.delete('/concern/:concern_id', authenticateAdmin, validate(deleteConcernSchema, 'params'), deleteConcern);

router.patch('/concern/approval-status', authenticateAdmin, validate(updateConcernApprovalStatusSchema, 'body'), updateConcernApprovalStatus);


const getFieldsFn = async (req) => {
  const certificationType = await clinicModels.getCertificateType();
  if (certificationType.length === 0) {
    return [];
  }
  const dynamicFields = certificationType.map(type => ({
    name: type.file_name ? type.file_name.toLowerCase() : '',
    maxCount: 10
  }));
  dynamicFields.push({ name: 'logo', maxCount: 1 });
  return dynamicFields;
};

router.patch("/update-clinic", authenticateAdmin, uploadDynamicClinicFiles(getFieldsFn), updateClinicAdmin);


router.patch("/update-doctor", authenticateAdmin, uploadFileTo('profile_images'), updateDoctorAdminController);



router.post("/add-clinic-onboarding", authenticateAdmin, uploadDynamicClinicFiles(getFieldsFn), clinicControllers.add_clinic_with_onboarding);
router.get("/get-treatments/:clinic_id", authenticateAdmin, clinicControllers.get_Clinic_Mapped_treatments);
router.post("/update-clinic", authenticateAdmin, uploadDynamicClinicFiles(getFieldsFn), clinicControllers.updateClinicController);

const uploadVariousFields = uploadCertificationFieldsTo([
  { name: 'medical_council', maxCount: 1, subfolder: 'certifications' },
  { name: 'deramatology_board', maxCount: 1, subfolder: 'certifications' },
  { name: 'laser_safety', maxCount: 1, subfolder: 'certifications' },
  { name: 'cosmetology_license', maxCount: 1, subfolder: 'certifications' },
  { name: "profile", maxCount: 1, subfolder: 'profile_images' },
]);

const uploadVariousFieldsForSoloDoctor = uploadCertificationFieldsTo([
  { name: 'medical_council', maxCount: 1, subfolder: 'certifications' },
  { name: 'deramatology_board', maxCount: 1, subfolder: 'certifications' },
  { name: 'laser_safety', maxCount: 1, subfolder: 'certifications' },
  { name: 'cosmetology_license', maxCount: 1, subfolder: 'certifications' },
  { name: 'profile', maxCount: 1 },
  { name: 'logo', maxCount: 1 },
  { name: 'files', maxCount: 50 }
]);


router.post("/add-doctor-onboarding", authenticateAdmin, uploadVariousFieldsForSoloDoctorDynamic, doctorControllers.sendDoctorOnaboardingInvitation);
router.post("/update-doctor", authenticateAdmin, uploadVariousFieldsForSoloDoctorDynamic, doctorControllers.updateDoctorController);
router.post("/update-doctor-status", authenticateAdmin, doctorControllers.updateDoctorStatusController);
router.post("/archive-expert-email", authenticateAdmin, doctorControllers.archiveExpertEmailController);

router.post("/add-solo-doctor-onboarding", authenticateAdmin, uploadVariousFieldsForSoloDoctorDynamic, doctorControllers.sendSoloDoctorOnaboardingInvitation);
router.post("/update-solo-doctor", authenticateAdmin, uploadVariousFieldsForSoloDoctorDynamic, doctorControllers.updateSoloDoctorController);
router.get("/get-surgery", authenticateAdmin, authControllersClinic.getAllSurgery)
router.get("/get-devices", authControllersClinic.getAllDevices);
router.get("/get-treatments", authControllersClinic.getAllTreatments);
router.get("/get-skin-types", authenticateAdmin, authControllersClinic.getClinicSkinTypes);
router.post("/clone-treatment/:treatment_id", authenticateAdmin, cloneTreatment);

router.get("/get-surgery/:clinic_id", authenticateAdmin, clinicControllers.getAllSurgeryOfClinicController)
router.get("/get-devices/:clinic_id", clinicControllers.getAllDevicesOfClinicController);
router.get("/get-skin-types/:clinic_id", authenticateAdmin, clinicControllers.getClinicSkinTypesOfClinicController);
router.delete("/clinin-images/:clinic_image_id", authenticateAdmin, validate(deleteClinicImageSchema, "params"), authControllersClinic.deleteClinicImage);
router.post("/generate-slots", authenticateAdmin, doctorControllers.generateAvailabilityFromOperationHours);

router.post("/clinic-unlinck", authenticateAdmin, doctorControllers.unsyncClinicController);

router.post("/send-doctor-invitation", authenticateAdmin, doctorControllers.sendDoctorInvitationListController);


router.get('/get-clinic-invitation-list', authenticateAdmin, doctorControllers.getClinicInvitationListController);


router.post('/likewiseterms', authenticateAdmin, validate(addEditLikeWiseSchema, 'body'), addEditLikeWiseTerms);

router.delete('/likewiseterms/:like_wise_term_id', authenticateAdmin, validate(deleteLikeWiseSchema, 'params'), deleteLikeWiseTerms);

router.patch('/likewiseterms', authenticateAdmin, validate(updateLikeWiseApprovalStatusSchema, 'body'), updateLikeWiseTermsApprovalStatus);


router.post('/device', authenticateAdmin, validate(addEditDevicesSchema, 'body'), addEditDevice);

router.delete('/device/:device_id', authenticateAdmin, validate(deleteDevicesSchema, 'params'), deleteDevice);

router.patch('/device', authenticateAdmin, validate(updateDevicesApprovalStatusSchema, 'body'), updateDeviceApprovalStatus);

router.post('/benefit', authenticateAdmin, validate(addEditBenefitsSchema, 'body'), addEditBenefit);

router.delete('/benefit/:benefit_id', authenticateAdmin, validate(deleteBenefitsSchema, 'params'), deleteBenefit);

router.patch('/benefit', authenticateAdmin, validate(updateBenefitsApprovalStatusSchema, 'body'), updateBenefitApprovalStatus);

router.get("/likewiseterms",authenticateAdmin,getAllLikeWiseTerms);

router.get("/device",authenticateAdmin,getAllDevices);

router.get("/benefit",authenticateAdmin,getAllBenefits);

// ✅ Delete Expert (Doctor) — with active appointment check
router.delete("/delete-expert/:doctor_id", authenticateAdmin, deleteExpertController);

export default router;
