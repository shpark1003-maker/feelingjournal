const fs = require('fs');
const content = fs.readFileSync('c:\\Dev\\feelingjournal\\public\\index.html', 'utf8');
console.log(content.includes('2024년 5월') ? 'Korean is intact!' : 'Korean is broken!');
console.log(content.includes('2024??5??') ? 'Has question marks!' : 'No question marks!');
