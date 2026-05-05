import logger from '../utils/logger.js';
const sessions = new Map();

export default {
  get: (userId) => {
    const val = sessions.get(userId) ?? null;
    try {
      logger.info('session.get', { userId, hit: !!val });
    } catch (e) {
      // fallback to basic logging
      logger.info('session.get', { userId, hit: !!val });
    }
    return val;
  },
  set: (userId, data) => {
    sessions.set(userId, data);
    try {
      const keys = data && typeof data === 'object' ? Object.keys(data).length : 0;
      logger.info('session.set', { userId, keys });
    } catch (e) {
      logger.info('session.set', { userId, stored: true });
    }
  },
  delete: (userId) => {
    const existed = sessions.delete(userId);
    try {
      logger.info('session.delete', { userId, deleted: existed });
    } catch (e) {
      logger.info('session.delete', { userId, deleted: existed });
    }
    return existed;
  }
};
