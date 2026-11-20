// Saved list views: each admin's named filter sets for the console's lists. Personal to the admin.
const mongoose = require('mongoose');
const AdminView = require('../models/AdminView');
const {asyncHandler, HttpError} = require('../utils/http');

const MAX_VIEWS_PER_LIST = 12;
// Only the console's own list pages can have views (a path inside /admin, no other sites).
const PATH = /^\/[a-z0-9/_-]{1,110}$/;

const list = asyncHandler(async (req, res) => {
  const path = String(req.query.path || '');
  if (!PATH.test(path)) throw new HttpError(400, 'Choose a list page.');
  const views = await AdminView.find({user: req.user._id, path})
    .sort({createdAt: 1})
    .select('name query')
    .lean();
  res.json({
    views: views.map((v) => ({
      id: String(v._id),
      name: v.name,
      query: v.query,
    })),
  });
});

const create = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const path = String(body.path || '');
  const name = String(body.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  const query = String(body.query || '')
    .replace(/^\?/, '')
    .slice(0, 600);
  if (!PATH.test(path)) throw new HttpError(400, 'Choose a list page.');
  if (name.length < 2 || name.length > 40)
    throw new HttpError(400, 'Name the view with 2 to 40 characters.', {
      name: 'Name the view with 2 to 40 characters.',
    });
  const count = await AdminView.countDocuments({user: req.user._id, path});
  if (count >= MAX_VIEWS_PER_LIST)
    throw new HttpError(
      409,
      `You can keep up to ${MAX_VIEWS_PER_LIST} views per list. Remove one first.`,
    );
  const view = await AdminView.create({user: req.user._id, path, name, query});
  res.status(201).json({
    message: `View "${name}" saved.`,
    view: {id: String(view._id), name, query},
  });
});

const remove = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.viewId))
    throw new HttpError(404, 'View not found.');
  const result = await AdminView.deleteOne({
    _id: req.params.viewId,
    user: req.user._id,
  });
  if (!result.deletedCount) throw new HttpError(404, 'View not found.');
  res.json({message: 'View removed.'});
});

module.exports = {list, create, remove};
