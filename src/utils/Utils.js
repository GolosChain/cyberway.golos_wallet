const core = require('cyberway-core-service');
const fetch = require('node-fetch');
const { JsonRpc, Api } = require('cyberwayjs');
const { TextEncoder, TextDecoder } = require('text-encoding');
const env = require('../data/env');
const Logger = core.utils.Logger;
const BigNum = core.types.BigNum;
const VestingBalance = require('../models/VestingBalance');
const VestingStat = require('../models/VestingStat');
const BalanceModel = require('../models/Balance');
const TokenModel = require('../models/Token');
const Withdrawal = require('../models/Withdrawal');
const DelegateVestingProposal = require('../models/DelegateVestingProposal');

const RPC = new JsonRpc(env.GLS_CYBERWAY_HTTP_URL, { fetch });

const API = new Api({
    rpc: RPC,
    signatureProvider: null,
    textDecoder: new TextDecoder(),
    textEncoder: new TextEncoder(),
});

class Utils {
    static getCyberApi() {
        return API;
    }

    static async getAccount({ userId }) {
        return await RPC.fetch('/v1/chain/get_account', { account_name: userId });
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

        if (!vestingBalance.liquid || !vestingBalance.liquid.balances.GOLOS) {
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

    static async convertTokensToVesting({ tokens }) {
        const { decs, amount } = await Utils.checkAsset(tokens);

        await Utils.checkDecsValue({ decs, requiredValue: 3 });

        const { balance, supply } = await Utils.getVestingSupplyAndBalance();

        return Utils.convertAssetToString({
            sym: 'GOLOS',
            amount: Utils.calculateConvertAmount({
                baseRaw: amount,
                multiplierRaw: supply,
                dividerRaw: balance,
            }),
            decs: 6,
        });
    }

    static async getVestingInfo() {
        const vestingStat = await VestingStat.findOne();

        if (!vestingStat) {
            return {};
        }

        return { stat: vestingStat.stat };
    }

    static async getBalance({ userId, currencies, type, shouldFetchStake = false }) {
        const result = {
            userId,
        };

        let tokensMap = {};

        if (type !== 'liquid') {
            const {
                vesting: total,
                delegated: outDelegate,
                received: inDelegated,
                withdraw,
            } = await Utils.getVestingBalance({ account: userId });

            result.vesting = { total, outDelegate, inDelegated, withdraw };
        }

        if (type !== 'vesting') {
            const balanceObject = await BalanceModel.findOne({ name: userId });

            if (balanceObject) {
                result.liquid = {
                    balances: {},
                    payments: {},
                };
                if (currencies.includes('all')) {
                    const allCurrencies = await TokenModel.find(
                        {},
                        { _id: false, sym: true },
                        { lean: true }
                    );

                    for (const currency of allCurrencies) {
                        tokensMap[currency.sym] = true;
                    }
                } else {
                    for (const token of currencies) {
                        tokensMap[token] = true;
                    }
                }
                for (const tokenBalance of balanceObject.balances) {
                    const { sym, quantityRaw } = await Utils.parseAsset(tokenBalance);
                    if (tokensMap[sym]) {
                        result.liquid.balances[sym] = quantityRaw;
                    }
                }
                for (const tokenPayments of balanceObject.payments) {
                    const { sym, quantityRaw } = await Utils.parseAsset(tokenPayments);
                    if (tokensMap[sym]) {
                        result.liquid.payments[sym] = quantityRaw;
                    }
                }
            }
        }

        if (shouldFetchStake) {
            const { stake_info: stakeInfo } = await Utils.getAccount({ userId });
            result.stakeInfo = stakeInfo;
        }

        return result;
    }

    static async getVestingSupplyAndBalance() {
        const vestingStat = await Utils.getVestingInfo();
        const vestingBalance = await Utils.getBalance({
            userId: 'gls.vesting',
            currencies: ['GOLOS'],
            type: 'liquid',
        });

        await Utils.checkVestingStatAndBalance({
            vestingBalance,
            vestingStat: vestingStat.stat,
        });

        const balance = await Utils.checkAsset(vestingBalance.liquid.balances.GOLOS);
        const supply = await Utils.checkAsset(vestingStat.stat);

        return {
            balance: balance.amount,
            supply: supply.amount,
        };
    }

    static async getVestingBalance({ account }) {
        const vestingBalance = await VestingBalance.findOne({ account });

        if (!vestingBalance) {
            return {};
        }

        vestingBalance.vesting = Utils.parseAsset(vestingBalance.vesting).quantityRaw;
        vestingBalance.delegated = Utils.parseAsset(vestingBalance.delegated).quantityRaw;
        vestingBalance.received = Utils.parseAsset(vestingBalance.received).quantityRaw;

        const { quantityRaw: vestingInGolos } = await Utils.convertVestingToToken({
            vesting: vestingBalance.vesting,
            type: 'parsed',
        });
        const { quantityRaw: delegatedInGolos } = await Utils.convertVestingToToken({
            vesting: vestingBalance.delegated,
            type: 'parsed',
        });
        const { quantityRaw: receivedInGolos } = await Utils.convertVestingToToken({
            vesting: vestingBalance.received,
            type: 'parsed',
        });

        const withdrawObject = await Withdrawal.findOne({ owner: account });
        let withdraw = {};

        if (withdrawObject) {
            const { quantityRaw: quantity } = await Utils.convertVestingToToken({
                vesting: withdrawObject.quantity,
                type: 'parsed',
            });

            const { quantityRaw: toWithdraw } = await Utils.convertVestingToToken({
                vesting: withdrawObject.to_withdraw,
                type: 'parsed',
            });

            withdraw = {
                quantity: `${quantity} GOLOS`,
                remainingPayments: withdrawObject.remaining_payments,
                nextPayout: withdrawObject.next_payout,
                toWithdraw: `${toWithdraw} GOLOS`,
            };
        }

        return {
            account,
            vesting: { GESTS: vestingBalance.vesting, GOLOS: vestingInGolos },
            delegated: { GESTS: vestingBalance.delegated, GOLOS: delegatedInGolos },
            received: { GESTS: vestingBalance.received, GOLOS: receivedInGolos },
            withdraw,
        };
    }

    static async convertVestingToToken({ vesting, type }) {
        const { decs, amount } = await Utils.checkAsset(vesting);

        await Utils.checkDecsValue({ decs, requiredValue: 6 });

        const { balance, supply } = await Utils.getVestingSupplyAndBalance();
        const resultString = Utils.convertAssetToString({
            sym: 'GOLOS',
            amount: Utils.calculateConvertAmount({
                baseRaw: amount,
                multiplierRaw: balance,
                dividerRaw: supply,
            }),
            decs: 3,
        });

        if (type === 'string') {
            return resultString;
        }
        return Utils.parseAsset(resultString);
    }

    static calculateConvertAmount({ baseRaw, multiplierRaw, dividerRaw }) {
        const base = new BigNum(baseRaw);
        const multiplier = new BigNum(multiplierRaw);
        const divider = new BigNum(dividerRaw);

        return base
            .times(multiplier)
            .div(divider)
            .dp(0)
            .toString();
    }

    static calculateWithdrawNextPayout(timestamp, intervalSeconds) {
        const np = new Date(timestamp);
        np.setSeconds(np.getSeconds() + intervalSeconds);
        return np;
    }

    static async getVestingDelegationProposals({ app, userId }) {
        const query = {
            toUserId: userId,
            expiration: { $gt: new Date() },
            isSignedByAuthor: true,
        };

        if (app === 'gls') {
            query.communityId = 'gls';
        } else {
            query.communityId = { $ne: 'gls' };
        }

        const proposals = await DelegateVestingProposal.aggregate([
            {
                $match: query,
            },
            {
                $sort: {
                    expiration: 1,
                },
            },
            {
                $lookup: {
                    from: 'usermetas',
                    localField: 'userId',
                    foreignField: 'userId',
                    as: 'usermeta',
                },
            },
            {
                $project: {
                    _id: false,
                    proposer: true,
                    proposalId: true,
                    expiration: true,
                    userId: true,
                    data: true,
                    'usermeta.username': true,
                },
            },
        ]);

        for (const proposal of proposals) {
            if (proposal.usermeta.length) {
                proposal.username = proposal.usermeta[0].username;
            }

            delete proposal.usermeta;
        }

        return proposals;
    }
}

module.exports = Utils;
