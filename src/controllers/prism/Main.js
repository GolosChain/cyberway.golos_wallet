const core = require('gls-core-service');
const Logger = core.utils.Logger;
const TransferModel = require('../../models/Transfer');
const BalanceModel = require('../../models/Balance');
const TokenModel = require('../../models/Token');
const VestingStat = require('../../models/VestingStat');
const VestingBalance = require('../../models/VestingBalance');
const VestingChange = require('../../models/VestingChange');
const UserMeta = require('../../models/UserMeta');

class Main {
    async disperse({ transactions }) {
        for (const transaction of transactions) {
            await this._disperseTransaction(transaction);
        }
    }

    async _disperseTransaction(transaction) {
        if (!transaction) {
            Logger.error('Empty transaction! But continue.');
            return;
        }

        const trxData = {
            trx_id: transaction.id,
            block: transaction.block_num,
            timestamp: transaction.block_time,
        };

        for (const action of transaction.actions) {
            if (action.code === 'cyber.token' && action.receiver === 'cyber.token') {
                switch (action.action) {
                    case 'transfer':
                        await this._handleTransferAction(action, trxData);
                        break;
                    case 'issue':
                        await this._handleEvents({ events: action.events });
                        break;
                    case 'create':
                        await this._handleEvents({ events: action.events });
                        break;
                    default:
                        break;
                }
            }

            if (
                action.receiver === 'gls.vesting' &&
                action.action == 'transfer' &&
                action.code === 'cyber.token'
            ) {
                await this._handleVestingEvents({ events: action.events });
            }

            if (
                action.receiver === 'gls.ctrl' &&
                action.action === 'changevest' &&
                action.code === 'gls.ctrl'
            ) {
                await this._handleChangeVestAction(action, trxData);
            }

            if (
                action.receiver == 'gls.social' &&
                action.code == 'gls.social' &&
                action.action == 'updatemeta'
            ) {
                await this._handleUpdateMetaAction(action, trxData);
            }
        }
    }

    async _handleTransferAction(action, trxData) {
        if (!action.args) {
            throw { code: 812, message: 'Invalid action object' };
        }

        const transferObject = {
            ...trxData,
            sender: action.args.from,
            receiver: action.args.to,
            quantity: action.args.quantity,
            memo: action.args.memo,
        };

        const transfer = new TransferModel(transferObject);

        await transfer.save();

        Logger.info('Created transfer object: ', transferObject);

        await this._handleEvents({ events: action.events });
    }

    async _handleChangeVestAction(action, trxData) {
        if (!action.args) {
            throw { code: 812, message: 'Invalid action object' };
        }

        const vestChangeObject = {
            ...trxData,
            who: action.args.who,
            diff: action.args.diff,
        };

        const vestChange = new VestingChange(vestChangeObject);

        await vestChange.save();

        Logger.info('Created vesting change object:', vestChangeObject);
    }

    async _handleUpdateMetaAction(action, trxData) {
        if (!action.args) {
            throw { code: 812, message: 'Invalid action object' };
        }

        const meta = {
            userId: action.args.account,
            username: action.args.meta.name,
        };

        const savedUserMeta = await UserMeta.findOne({ userId: meta.userId });

        if (savedUserMeta) {
            await UserMeta.updateOne({ _id: savedUserMeta._id }, { $set: meta });
            Logger.info(`Changed meta data of user ${meta.userId}: ${JSON.stringify(meta, null, 2)}`);
        }
        else {
            const userMeta = new UserMeta(meta);
            await userMeta.save();
            Logger.info(`Created meta data of user ${meta.userId}: ${JSON.stringify(meta, null, 2)}`);
        }
    }

    async _handleEvents({ events }) {
        for (const event of events) {
            await this._handleBalanceEvent(event);
            await this._handleCurrencyEvent(event);
        }
    }

    async _handleVestingEvents({ events }) {
        for (const event of events) {
            await this._handleVestingStatEvent(event);
            await this._handleVestingBalanceEvent(event);
        }
    }

    async _handleBalanceEvent(event) {
        // Ensure given event is balance event
        if (!(event.code === 'cyber.token' && event.event === 'balance')) {
            return;
        }

        const balance = await BalanceModel.findOne({ name: event.args.account });
        const sym = await this._getAssetName(event.args.balance);

        if (balance) {
            // Check balance of tokens listed in balance.balances array
            const neededSym = sym;
            let neededTokenId = null;

            for (let i = 0; i < balance.balances.length; i++) {
                const tokenSym = await this._getAssetName(balance.balances[i]);
                if (tokenSym === neededSym) {
                    neededTokenId = i;
                }
            }

            // Modify if such token is present and create new one otherwise
            if (neededTokenId != null) {
                let objectToModify = {};
                const idString = 'balances.' + neededTokenId;
                objectToModify[idString] = event.args.balance;

                await BalanceModel.updateOne({ _id: balance._id }, { $set: objectToModify });
            } else {
                await balance.balances.push(event.args.balance);
                await balance.save();
            }

            Logger.info(
                'Updated balance object of user',
                event.args.account,
                ':',
                event.args.balance
            );
        } else {
            const newBalance = new BalanceModel({
                name: event.args.account,
                balances: [event.args.balance],
            });

            await newBalance.save();

            Logger.info(
                'Created balance object of user',
                event.args.account,
                ':',
                event.args.balance
            );
        }
    }

    async _handleCurrencyEvent(event) {
        // Ensure given event is currency event
        if (!(event.code === 'cyber.token' && event.event === 'currency')) {
            return;
        }
        const sym = await this._getAssetName(event.args.supply);
        const tokenObject = await TokenModel.findOne({ sym });

        const newTokenInfo = {
            sym,
            issuer: event.args.issuer,
            supply: event.args.supply,
            max_supply: event.args.max_supply,
        };

        if (tokenObject) {
            await TokenModel.updateOne({ _id: tokenObject._id }, { $set: newTokenInfo });

            Logger.info('Updated', sym, 'token info:', newTokenInfo);
        } else {
            const newToken = new TokenModel(newTokenInfo);

            await newToken.save();

            Logger.info('Created', sym, 'token info:', newTokenInfo);
        }
    }

    async _handleVestingStatEvent(event) {
        // Ensure given event is stat event
        // TODO: Add correct `event.code` check, when it'll be stable...
        if (!(event.event === 'stat')) {
            return;
        }

        const statObject = await VestingStat.findOne({ sym: event.args.sym });

        const newStats = {
            stat: event.args,
        };
        const sym = await this._getAssetName(newStats.stat);

        if (statObject) {
            await statObject.updateOne({ _id: statObject._id }, { $set: newStats });

            Logger.info('Updated', sym, 'token info:', newStats);
        } else {
            const newVestingStat = new VestingStat(newStats);

            await newVestingStat.save();

            Logger.info('Created', sym, 'token info:', newStats);
        }
    }

    async _handleVestingBalanceEvent(event) {
        // Ensure given event is balance event

        // TODO: Add correct `event.code` check, when it'll be stable...
        if (!(event.event === 'balance')) {
            return;
        }

        const vestingBalance = await VestingBalance.findOne({ account: event.args.account });

        const newVestingBalance = {
            account: event.args.account,
            vesting: event.args.vesting,
            delegated: event.args.delegated,
            received: event.args.received,
        };

        // needed for pretty logs
        const vestingLogObject = {
            vesting: event.args,
        };

        if (vestingBalance) {
            await VestingBalance.updateOne(
                { _id: vestingBalance._id },
                { $set: newVestingBalance }
            );

            Logger.info(
                'Updated vesting balance object of user',
                event.args.account,
                ':',
                vestingLogObject
            );
        } else {
            const newVestingBalanceObject = new VestingBalance(newVestingBalance);

            await newVestingBalanceObject.save();

            Logger.info(
                'Created vesting balance object of user',
                event.args.account,
                ': ',
                vestingLogObject
            );
        }
    }

    async _getAssetName(asset) {
        return asset.split(' ')[1];
    }
}

module.exports = Main;
