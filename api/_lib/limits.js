const validLicenseKey = (v) => typeof v === "string" && v.length >= 8 && v.length <= 128 && /^[A-Za-z0-9-]+$/.test(v);
const validInstanceName = (v) => typeof v === "string" && v.length >= 1 && v.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v);
const validEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v);
const trimLicenseKey = (v) => (typeof v === "string" ? v.trim() : v);
module.exports = { trimLicenseKey, validLicenseKey, validInstanceName, validEmail };
