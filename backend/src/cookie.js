const { env } = require("./config");

const secureCookie =
  env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV !== "development"
    : env.COOKIE_SECURE !== "false";

const cookieOptions = {
  // Keep cookies secure by default. Local HTTP development can explicitly set
  // COOKIE_SECURE=false; production deployments should leave it enabled.
  secure: secureCookie,
  sameSite: "lax",
  path: "/",
  domain: env.COOKIE_DOMAIN || undefined,
};

const setAccessTokenCookie = (res, accessToken) => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    maxAge: env.JWT_ACCESS_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });
};
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    maxAge: env.JWT_REFRESH_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });
};
const setCsrfTokenCookie = (res, csrfToken) => {
  res.cookie("csrfToken", csrfToken, {
    httpOnly: false,
    maxAge: env.CSRF_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });
};
const setAllCookies = (res, accessToken, refreshToken, csrfToken) => {
  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, refreshToken);
  setCsrfTokenCookie(res, csrfToken);
};

const clearAllCookies = (res) => {
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);
  res.clearCookie("csrfToken", cookieOptions);
};

const clearAccessAndCsrfCookies = (res) => {
  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("csrfToken", cookieOptions);
};

module.exports = {
  setAccessTokenCookie,
  setRefreshTokenCookie,
  setCsrfTokenCookie,
  setAllCookies,
  clearAllCookies,
  clearAccessAndCsrfCookies,
};
