const fs = require('fs');
const cheerio = require('cheerio');
const $ = cheerio.load(fs.readFileSync('raw_electron_dump.html', 'utf8'));
$('.post-item').slice(0,10).each((i, el) => {
  const title = $(el).find('.the-post-title').text().trim() || $(el).find('.post-title a').text().trim();
  const img = $(el).find('img.thumbnail-image');
  console.log('Title:', title);
  console.log('src:', img.attr('src'));
  console.log('data-src:', img.attr('data-src'));
  console.log('data-src-webp:', img.attr('data-src-webp'));
  console.log('---');
});
