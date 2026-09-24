const fs = require('fs');
const glob = require('glob');
const files = glob.sync('src/controllers/*Controller.ts');
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split('UPPER(TRIM(i.work_order_id)) = UPPER(TRIM($1))').join('i.work_order_id = $1');
  fs.writeFileSync(file, content);
});
console.log('Replaced successfully');
