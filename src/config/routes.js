import express from "express";
import cookieParser from "cookie-parser";

//==================================== Import Routes ==============================

import api_routes from "../routes/api.js"
import admin_routes from "../routes/admin.js";
import clinic_routes from "../routes/clinic.js";
import web_user_routes from "../routes/web_user.js";
import doctor_routes from "../routes/doctor.js";
import solo_doctor_routes from "../routes/solo_doctor.js";
import embed_routes from "../routes/embeddings.js";


//==================================== configureApp ==============================

const configureApp = (app) => {
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use("/api", api_routes);
  app.use("/admin", admin_routes);
  app.use("/clinic", clinic_routes);
  app.use("/webuser", web_user_routes);
  app.use("/doctor", doctor_routes);
  app.use("/solo_doctor", solo_doctor_routes);
  app.use("/embed", embed_routes);

};

export default configureApp;
