// GET /find-my-size?cm=25.3  (public, a plain form: no script, nothing stored)
const sizeFinderService = require('../services/sizeFinderService');
const {asyncHandler} = require('../utils/http');

const sizeFinder = asyncHandler(async (req, res) => {
  const raw = req.query.cm;
  let result = null;
  let error = '';
  if (raw !== undefined && raw !== '') {
    try {
      result = sizeFinderService.sizeFor(raw);
    } catch (e) {
      error = e.message;
    }
  }
  res.render('pages/size-finder', {
    title: 'Find my shoe size | Nexthlon',
    result,
    error,
    value: raw ? String(raw).slice(0, 8) : '',
    min: sizeFinderService.MIN_CM,
    max: sizeFinderService.MAX_CM,
  });
});

module.exports = {sizeFinder};
