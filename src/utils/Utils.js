const core = require('gls-core-service');
const Logger = core.utils.Logger;
const BigNum = core.types.BigNum;

class Utils {
    static async extractArgumentList({ args, fields }) {
        if (!Array.isArray(fields)) {
            Logger.warn('_extractArgumentList: invalid argument');
            throw { code: 805, message: 'Wrong arguments' };
        }

        for (const f of fields) {
            if (typeof f !== 'string') {
                Logger.warn('_extractArgumentList: invalid argument:', f);
                throw { code: 805, message: 'Wrong arguments' };
            }
        }

        const result = {};

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

    static checkAsset(asset) {
        if (typeof asset !== 'string') {
            return;
        }

        const parts = asset.split(' ');

        let amountString = parts[0];
        amountString = amountString.replace('.', '');

        let decsString = parts[0];
        decsString = decsString.split('.')[1];

        const sym = parts[1];
        const amount = parseInt(amountString);
        const decs = decsString.length;

        return { sym, amount, decs };
    }

    static convertAssetToString({ sym, amount, decs }) {
        const divider = new BigNum(10).pow(decs);
        const leftPart = new BigNum(amount).div(divider).toString();

        return `${leftPart} ${sym}`;
    }
    // conversion methods helpers

    static checkVestingStatAndBalance({ vestingBalance, vestingStat }) {
        if (!vestingStat) {
            Logger.error('convert: no records about vesting stats in base');
            throw { code: 811, message: 'Data is absent in base' };
        }

        if (!vestingBalance.liquid || !vestingBalance.liquid.GOLOS) {
            Logger.error('convert: no GOLOS balance for gls.vesting account');
            throw { code: 811, message: 'Data is absent in base' };
        }
    }

    static checkDecsValue({ decs, requiredValue }) {
        if (decs !== requiredValue) {
            Logger.error(`convert: invalid argument ${decs}. decs must be equal ${requiredValue}`);
            throw { code: 805, message: 'Wrong arguments' };
        }
    }

    static parseAsset(asset) {
        if (!asset) {
            throw new Error('Asset is not defined');
        }
        const [quantityRaw, sym] = asset.split(' ');
        const quantity = new BigNum(asset);
        return {
            quantityRaw,
            quantity,
            sym,
        };
    }

    // Converts transfers quantity data to asset string
    // Like: "123.000 GLS"
    static formatQuantity(quantity) {
        return (
            new BigNum(quantity.amount).shiftedBy(-quantity.decs).toString() + ' ' + quantity.sym
        );
    }
}

module.exports = Utils;