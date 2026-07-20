// Injection token lives in its own file to avoid circular imports:
// users.module.ts imports users.controller.ts, and users.controller.ts
// needs this token. Colocating the token in either of those files causes
// the token to be `undefined` at decorator-evaluation time.
export const USERS_CLIENT = 'USERS_CLIENT';
