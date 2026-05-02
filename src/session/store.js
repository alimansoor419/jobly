const sessions = new Map();

export default {
  get: (userId) => {
    const val = sessions.get(userId) ?? null;
    console.log(`[SESSION] get ${userId} -> ${val ? 'hit' : 'miss'}`);
    return val;
  },
  set: (userId, data) => {
    sessions.set(userId, data);
    try {
      const keys = data && typeof data === 'object' ? Object.keys(data).length : 0;
      console.log(`[SESSION] set ${userId} -> stored (${keys} keys)`);
    } catch (e) {
      console.log(`[SESSION] set ${userId} -> stored`);
    }
  },
  delete: (userId) => {
    const existed = sessions.delete(userId);
    console.log(`[SESSION] delete ${userId} -> ${existed ? 'deleted' : 'none'}`);
    return existed;
  }
};
