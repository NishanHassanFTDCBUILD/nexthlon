// The admin product form sends about 21 text fields with its photos. The upload must accept that form.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {productImages} = require('../middleware/upload');

test('upload: a product form with 21 text fields and a photo is accepted', async () => {
  const app = express();
  app.post('/up', productImages, (req, res) =>
    res.json({
      files: (req.files || []).length,
      fields: Object.keys(req.body).length,
    }),
  );
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const form = new FormData();
    for (let i = 0; i < 21; i += 1) form.append(`field${i}`, `value ${i}`);
    form.append(
      'images',
      new Blob(
        [
          Buffer.from([
            0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0,
            1, 0, 0,
          ]),
        ],
        {type: 'image/jpeg'},
      ),
      'photo.jpg',
    );
    const res = await fetch(`http://127.0.0.1:${server.address().port}/up`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.files, 1);
    assert.equal(data.fields, 21);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
