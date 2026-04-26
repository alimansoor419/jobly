const sessions = new Map();

export default {
  get: (userId) => sessions.get(userId) ?? null,
  set: (userId, data) => sessions.set(userId, data),
  delete: (userId) => sessions.delete(userId)
};
