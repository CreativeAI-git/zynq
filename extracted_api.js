    export const getDoctorsByFirstNameSearchOnlyController = asyncHandler(async (req, res) => {
        const { language = 'en' } = req.user || {};

        let { filters = {}, page, limit } = req.body || {};

        const search = filters.search?.trim() || "";

        if (!search) {
            return handleError(res, 400, language, "EMPTY_SEARCH_QUERY");
        }

        try {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                normalized_search = search
                if (language !== "en") {
                    console.log("Long query, translating to english");
                    normalized_search = await translator(search, 'en');
                }
            }
            // ≡ƒºá Detect if the translated text is gibberish
            const gibberish = isGibberishText(normalized_search);

            if (gibberish) {
                return handleError(res, 200, language, "Invalid Search", []);
            }


            // 2∩╕ÅΓâú Run all searches (as you already do)
            const [doctors] = await Promise.all([

                userModels.getDoctorsByFirstNameSearchOnly({ search: normalized_search, page, limit }),
            ]);


            // 3∩╕ÅΓâú Enrich images (same as your code)
            const enrichedDoctors = doctors.map(({ embeddings, ...doctor }) => ({
                ...doctor,
                profile_image: formatImagePath(doctor.profile_image, 'doctor/profile_images'),
                skin_types: language === 'en' ? doctor.skin_types : doctor.skin_types_swedish,
            }));


            // 5∩╕ÅΓâú Return ranked response
            return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', enrichedDoctors);

        } catch (error) {
            console.error("Search Home Error:", error);
            return handleError(res, 500, language, "INTERNAL_SERVER_ERROR");
        }
    });

    export const getClinicsByNameSearchOnlyController = asyncHandler(async (req, res) => {
        const { language = 'en' } = req.user || {};

        let { filters = {}, page, limit } = req.body || {};

        const search = filters.search?.trim() || "";

        if (!search) {
            return handleError(res, 400, language, "EMPTY_SEARCH_QUERY");
        }

        try {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                normalized_search = search
                if (language !== "en") {
                    console.log("Long query, translating to english");
                    normalized_search = await translator(search, 'en');
                }
            }
            // ≡ƒºá Detect if the translated text is gibberish
            const gibberish = isGibberishText(normalized_search);

            if (gibberish) {
                return handleError(res, 200, language, "Invalid Search", []);
            }


            // 2∩╕ÅΓâú Run all searches (as you already do)
            const [clinics] = await Promise.all([

                userModels.getClinicsByNameSearchOnly({ search: normalized_search, page, limit })
            ]);


            // 3∩╕ÅΓâú Enrich images (same as your code)
            const enrichedClinics = clinics.map(clinic => ({
                ...clinic,
                clinic_logo: formatImagePath(clinic.clinic_logo, 'clinic/logo'),
                treatments: clinic.treatments.map(treatment => language == "en" ? treatment.name : treatment.swedish)
            }));


            // 5∩╕ÅΓâú Return ranked response
            return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', enrichedClinics);

        } catch (error) {
            console.error("Search Home Error:", error);
            return handleError(res, 500, language, "INTERNAL_SERVER_ERROR");
        }
    });


    export const getDevicesByNameSearchOnlyController = asyncHandler(async (req, res) => {
        const { language = 'en' } = req.user || {};

        let { filters = {}, page, limit } = req.body || {};

        const search = filters.search?.trim() || "";

        if (!search) {
            return handleError(res, 400, language, "EMPTY_SEARCH_QUERY");
        }

        try {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                console.log("Long query, translating to english");
                normalized_search = search
                if (language !== "en") {
                    normalized_search = await translator(search, 'en');
                }
            }
            // ≡ƒºá Detect if the translated text is gibberish
            const gibberish = isGibberishText(normalized_search);

            if (gibberish) {
                return handleError(res, 200, language, "Invalid Search", []);
            }

            // 2∩╕ÅΓâú Run all searches
            const queryInfo = parseSearchIntent(search || normalized_search);

            const [devices, treatments] = await Promise.all([
                userModels.getDevicesByNameSearchOnly({ search: normalized_search, page, limit }),
                userModels.getTreatmentsBySearchOnly({ search: normalized_search, language, page, limit, actualSearch: search })
            ]);

            const typedPrimaryDevices = enforceDeviceSectionCandidates(devices, queryInfo, {
                minRelationshipStrength: queryInfo.intentType === "strict_category" ? 0.66 : 0.50
            });

            const relationExpansion = await userModels.getRelationshipAwareSearchExpansion({
                search: normalized_search,
                language,
                seedDevices: typedPrimaryDevices.accepted,
                seedTreatments: treatments
            });

            // The user specifically wants relationship expansion to enrich the device section
            const mergedDevices = mergeGraphAwareResults(typedPrimaryDevices.accepted, relationExpansion.devices || [], {
                keySelector: (row) => row?.id || `${row?.device_id || ""}:${row?.treatment_id || ""}`,
                nameSelector: (row) => row?.device_name || "",
                scoreSelector: (row) => row?.final_score ?? row?.score ?? 0,
                primaryPriority: 1,
                relatedDefaultPriority: 2
            });

            // 5∩╕ÅΓâú Return ranked response
            return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', mergedDevices);

        } catch (error) {
            console.error("Search Home Error:", error);
            return handleError(res, 500, language, "INTERNAL_SERVER_ERROR");
        }
    });

    export const gettreatmentsBySearchOnlyController = asyncHandler(async (req, res) => {
        const { language = 'en' } = req.user || {};
        let { filters = {}, page, limit } = req.body || {};
        const debugSearch = Boolean(filters?.debug_search);

        const search = filters.search?.trim() || "";

        if (!search) {
            return handleError(res, 400, language, "EMPTY_SEARCH_QUERY");
        }

        try {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                console.log("Long query, translating to english");
                normalized_search = await translator(search, 'en');
            }
            // ≡ƒºá Detect if the translated text is gibberish
            const gibberish = isGibberishText(normalized_search);

            if (gibberish) {
                return handleError(res, 200, language, "Invalid Search", []);
            }


            // 2∩╕ÅΓâú Run all searches
            const queryInfo = parseSearchIntent(search || normalized_search);
            console.log("[TREATMENT API DEBUG] queryInfo:", queryInfo);

            const [devices, rawTreatments] = await Promise.all([
                userModels.getDevicesByNameSearchOnly({ search: normalized_search, page, limit }),
                userModels.getTreatmentsBySearchOnly({
                    search: normalized_search,
                    language,
                    page,
                    limit,
                    actualSearch: search,
                    debug: debugSearch
                })
            ]);

            console.log("[TREATMENT API DEBUG] raw devices fetched length:", devices?.length);

            const typedPrimaryDevices = enforceDeviceSectionCandidates(devices, queryInfo, {
                minRelationshipStrength: queryInfo.intentType === "strict_category" ? 0.66 : 0.50
            });

            console.log("[TREATMENT API DEBUG] typedPrimaryDevices accepted length:", typedPrimaryDevices?.accepted?.length);

            const treatmentsArray = (debugSearch && rawTreatments && typeof rawTreatments === "object" && Array.isArray(rawTreatments.items))
                ? rawTreatments.items
                : rawTreatments;

            console.log("[TREATMENT API DEBUG] treatmentsArray length:", treatmentsArray?.length);

            const relationExpansion = await userModels.getRelationshipAwareSearchExpansion({
                search: normalized_search,
                language,
                seedDevices: typedPrimaryDevices.accepted,
                seedTreatments: treatmentsArray
            });

            console.log("[TREATMENT API DEBUG] relationExpansion.treatments length:", relationExpansion?.treatments?.length);

            const mergedTreatments = mergeGraphAwareResults(treatmentsArray, relationExpansion.treatments, {
                keySelector: (row) => row?.treatment_id,
                nameSelector: (row) => row?.name || row?.swedish || "",
                scoreSelector: (row) => row?.score ?? row?.final_score ?? row?.lexical_score ?? 0,
                primaryPriority: 1,
                relatedDefaultPriority: 2
            });

            console.log("[TREATMENT API DEBUG] mergedTreatments length:", mergedTreatments?.length);

            // 5∩╕ÅΓâú Return ranked response
            if (debugSearch && rawTreatments && typeof rawTreatments === "object" && Array.isArray(rawTreatments.items)) {
                return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', {
                    results: mergedTreatments,
                    debug: rawTreatments.debug || {}
                });
            }

            return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', mergedTreatments);

        } catch (error) {
            console.error("Search Home Error:", error);
            return handleError(res, 500, language, "INTERNAL_SERVER_ERROR");
        }
    });




    export const getSubtreatmentsBySearchOnlyController = asyncHandler(async (req, res) => {
        const { language = 'en' } = req.user || {};

        let { filters = {}, page, limit } = req.body || {};

        const search = filters.search?.trim() || "";

        if (!search) {
            return handleError(res, 400, language, "EMPTY_SEARCH_QUERY");
        }

        try {
            var normalized_search;
            if (search.length <= 3) {
                console.log("Short query, returning default valid_medical");
                normalized_search = search
            } else {
                console.log("Long query, translating to english");
                normalized_search = search;
                if (language != 'en') { normalized_search = await translator(search, 'en'); }

            }
            // ≡ƒºá Detect if the translated text is gibberish
            const gibberish = isGibberishText(normalized_search);

            if (gibberish) {
                return handleError(res, 200, language, "Invalid Search", []);
            }


            // 2∩╕ÅΓâú Run all searches
            const queryInfo = parseSearchIntent(search || normalized_search);

            const [devices, treatments, subtreatments] = await Promise.all([
                userModels.getDevicesByNameSearchOnly({ search: normalized_search, page, limit }),
                userModels.getTreatmentsBySearchOnly({ search: normalized_search, language, page, limit, actualSearch: search }),
                userModels.getSubTreatmentsBySearchOnly({ search: normalized_search, language, page, limit, actualSearch: search })
            ]);

            const typedPrimaryDevices = enforceDeviceSectionCandidates(devices, queryInfo, {
                minRelationshipStrength: queryInfo.intentType === "strict_category" ? 0.66 : 0.50
            });

            const relationExpansion = await userModels.getRelationshipAwareSearchExpansion({
                search: normalized_search,
                language,
                seedDevices: typedPrimaryDevices.accepted,
                seedTreatments: treatments
            });

            const mergedTreatments = mergeGraphAwareResults(treatments, relationExpansion.treatments, {
                keySelector: (row) => row?.treatment_id,
                nameSelector: (row) => row?.name || row?.swedish || "",
                scoreSelector: (row) => row?.score ?? row?.final_score ?? row?.lexical_score ?? 0,
                primaryPriority: 1,
                relatedDefaultPriority: 2
            });

            const relatedSubTreatments = await userModels.getSubTreatmentsByTreatmentIds({
                treatmentIds: mergedTreatments.map((t) => t?.treatment_id).filter(Boolean),
                language,
                limit: null,
                page: null
            });

            const mergedSubTreatments = mergeGraphAwareResults(subtreatments, relatedSubTreatments, {
                keySelector: (row) => row?.sub_treatment_id,
                nameSelector: (row) => row?.name || row?.swedish || "",
                scoreSelector: (row) => row?.final_score ?? row?.score ?? row?.name_score ?? 0,
                primaryPriority: 1,
                relatedDefaultPriority: 2
            });

            // 5∩╕ÅΓâú Return ranked response
            return handleSuccess(res, 200, language, 'SEARCH_RESULTS_FETCHED', mergedSubTreatments);

        } catch (error) {
            console.error("Search Home Error:", error);
            return handleError(res, 500, language, "INTERNAL_SERVER_ERROR");
        }
    });
