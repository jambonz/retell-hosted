const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const getE164 = async(logger, number, country) => {
  try {
    const n = phoneUtil.parseAndKeepRawInput(number, country);
    if (phoneUtil.isValidNumber(n)){
      return phoneUtil.format(n, PNF.E164)//.replace('+', '') //Strip the +
    } else {
      logger.warn(`to: ${number} is not a valid phone number in ${country}`)
	}
  } catch (err) {
    logger.warn({err}, `Error formatting number ${number} to E164, going to use it unchanged`);
  }
  return number;
}

const validateCountryCode= async(code) => {
    // list created by https://www.npmjs.com/package/i18n-iso-countries but hard coded as they hardley ever change so avoids adding more dependencies
    countries = ["AF","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT","AZ","BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BA","BW","BV","BR","IO","BN","BG","BF","BI","KH","CM","CA","CV","KY","CF","TD","CL","CN","CX","CC","CO","KM","CG","CD","CK","CR","CI","HR","CU","CY","CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","ET","FK","FO","FJ","FI","FR","GF","PF","TF","GA","GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GN","GW","GY","HT","HM","VA","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MO","MG","MW","MY","MV","ML","MT","MH","MQ","MR","MU","YT","MX","FM","MD","MC","MN","MS","MA","MZ","MM","NA","NR","NP","NL","NC","NZ","NI","NE","NG","NU","NF","MP","MK","NO","OM","PK","PW","PS","PA","PG","PY","PE","PH","PN","PL","PT","PR","QA","RE","RO","RU","RW","SH","KN","LC","PM","VC","WS","SM","ST","SA","SN","SC","SL","SG","SK","SI","SB","SO","ZA","GS","ES","LK","SD","SR","SJ","SZ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT","TN","TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN","VG","VI","WF","EH","YE","ZM","ZW","AX","BQ","CW","GG","IM","JE","ME","BL","MF","RS","SX","SS","XK"]
    if (countries.includes(code)){
      return true
  } else {
      throw new Error('Invalid DEFAULT COUNTRY, must contain ISO-3166-1-alpha2 values')
  }
}

module.exports = { getE164, validateCountryCode };
