const core = require('gls-core-service');
const Logger = core.utils.Logger;

class ParamsUtils {
    async extractSingleArgument({ args, fieldName }) {
        if (typeof fieldName !== 'string') {
            Logger.warn(`_extractSingleArgument: invalid argument ${fieldName}`);
            throw { code: 805, message: 'Wrong arguments' };
        }

        let result;

        if (args) {
            if (Array.isArray(args)) {
                result = args[0];
            } else {
                result = args[fieldName];
            }
        }

        if (!result || typeof result !== 'string') {
            Logger.warn('Wrong arguments');
            throw { code: 805, message: 'Wrong arguments' };
        }

        return result;
    }

    async extractArgumentList({ args, fields }) {
        if (!Array.isArray(fields)) {
            Logger.warn(`_extractArgumentList: invalid argument`);
            throw { code: 805, message: 'Wrong arguments' };
        }
        for (const f of fields) {
            if (typeof f !== 'string') {
                Logger.warn(`_extractArgumentList: invalid argument ${f}`);
                throw { code: 805, message: 'Wrong arguments' };
            }
        }

        let result = {};

        if (args) {
            if (Array.isArray(args)) {
                if (args.length !== fields.length) {
                    Logger.warn(
                        `_extractArgumentList: invalid argument: args.length !== fields.length`
                    );
                    throw { code: 805, message: 'Wrong arguments' };
                }

                for (const i in args) {
                    result[fields[i]] = args[i];
                }
            } else {
                for (const f of fields) {
                    result[f] = args[f];
                }
            }
        }

        return result;
    }
}

module.exports = ParamsUtils;