/**
 * Converts numeric Indian currency amount into words
 * e.g. 8500 -> "Eight Thousand Five Hundred Rupees Only"
 */
function numberToWordsINR(amount) {
  const num = Math.floor(Number(amount) || 0);
  const paise = Math.round(((Number(amount) || 0) - num) * 100);

  if (num === 0 && paise === 0) return 'Zero Rupees Only';

  const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(n) {
    if (n < 20) return single[n];
    return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + single[n % 10] : '');
  }

  function convertGroup(n) {
    if (n === 0) return '';
    if (n < 100) return convertTwoDigits(n);
    return single[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' ' + convertTwoDigits(n % 100) : '');
  }

  let words = '';
  const crore = Math.floor(num / 10000000);
  const remainderCrore = num % 10000000;
  const lakh = Math.floor(remainderCrore / 100000);
  const remainderLakh = remainderCrore % 100000;
  const thousand = Math.floor(remainderLakh / 1000);
  const remainderThousand = remainderLakh % 1000;

  if (crore > 0) words += convertGroup(crore) + ' Crore ';
  if (lakh > 0) words += convertGroup(lakh) + ' Lakh ';
  if (thousand > 0) words += convertGroup(thousand) + ' Thousand ';
  if (remainderThousand > 0) words += convertGroup(remainderThousand);

  words = words.trim();
  if (words.length > 0) words += ' Rupees';

  if (paise > 0) {
    words += (words.length > 0 ? ' and ' : '') + convertTwoDigits(paise) + ' Paise';
  }

  return words ? words + ' Only' : 'Zero Rupees Only';
}

module.exports = { numberToWordsINR };
