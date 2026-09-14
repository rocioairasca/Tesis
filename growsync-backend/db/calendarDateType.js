// PostgreSQL DATE (1082) is a calendar label, not an instant.
// Leave timestamp (1114) and timestamptz (1184) handlers unchanged.
module.exports = {
  calendarDate: {
    to: 1082,
    from: [1082],
    serialize: value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new TypeError('PostgreSQL DATE requires YYYY-MM-DD');
      }
      return value;
    },
    parse: value => value,
  },
};
