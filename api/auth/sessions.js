'use strict';

const { allowMethods, sendJson, sendError } = require('../_lib/http');
const { requireUser, listUserSessions } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['GET'])) {
    return;
  }

  try {
    const user = await requireUser(req);
    const items = await listUserSessions(req, user.id);

    sendJson(res, 200, {
      count: items.length,
      items
    });
  } catch (error) {
    sendError(res, error);
  }
};
