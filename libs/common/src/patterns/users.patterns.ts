// Message patterns are the "URLs" of microservices — strings that identify
// which handler on the other side should receive a message.
// Keeping them in a shared lib means gateway and users-service can never drift.
export const USERS_PATTERNS = {
  CREATE: { cmd: 'users.create' },
  FIND_ALL: { cmd: 'users.findAll' },
  FIND_ONE: { cmd: 'users.findOne' },
} as const;