"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDataConnectTriggerRegion = void 0;
const error_1 = require("../../../error");
function ensureDataConnectTriggerRegion(endpoint) {
    if (!endpoint.eventTrigger.region) {
        endpoint.eventTrigger.region = endpoint.region;
    }
    if (endpoint.eventTrigger.region !== endpoint.region) {
        throw new error_1.FirebaseError("The Firebase Data Connect trigger location must match the function region.");
    }
    return Promise.resolve();
}
exports.ensureDataConnectTriggerRegion = ensureDataConnectTriggerRegion;
