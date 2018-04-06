const assign = require('lodash/assign');
const isFunction = require('lodash/isFunction');
const isUndefined = require('lodash/isUndefined');
const reduce = require('lodash/reduce');
const trim = require('lodash/trim');

const definitionsRegex = /\$\w+:\s*[^$,)]*/g;
const extractInnerRegex = /\{.*\}/g;
const reduceStringRegex = /\s{2,}/g;

const hash = str => {
    let hash = 5381,
        i = str.length;

    while (i) {
        hash = (hash * 33) ^ str.charCodeAt(--i);
    }

    return hash >>> 0;
};

module.exports = class GraphQLMux {
    constructor(executor, type = 'query', wait = 10) {
        if (!isFunction(executor)) {
            throw new Error('executor should be a function.');
        }

        this.setup();

        this.executor = executor;
        this.type = type;
        this.wait = wait;
	}
	
    id(requestString, variableValues = {}) {
        return hash(requestString + JSON.stringify(variableValues));
    }

    setup() {
        this.resolvers = [];
        this.rejecters = [];
        this.definitions = {};
        this.requestString = [];
        this.variableValues = {};
    }

    graphql({
        requestString = '',
        variableValues = {}
    }) {
        clearTimeout(this.timeout);

		const id = this.id(requestString, variableValues);
        const definitions = reduce(requestString.match(definitionsRegex), (reduction, token) => {
            const [
                key,
                value
            ] = token.split(':');

            return assign({}, reduction, {
                [trim(key)]: trim(value)
            });
        }, {});

        requestString = requestString.replace(reduceStringRegex, ' ');
        requestString = requestString.match(extractInnerRegex)[0];
        requestString = trim(requestString, /\{\}/g);

        this.variableValues = reduce(variableValues, (reduction, value, key) => {
            if (!isUndefined(value)) {
                reduction[`${key}_${id}`] = value;

                requestString = requestString.replace(new RegExp(`\\$${key}`, 'g'), `$${key}_${id}`);
            }

            return reduction;
        }, this.variableValues);

        this.definitions = reduce(definitions, (reduction, value, key) => {
            const hasVariable = !isUndefined(this.variableValues[`${key.slice(1)}_${id}`]);

            reduction[hasVariable ? `${key}_${id}` : key] = value;

            return reduction;
        }, this.definitions);

        this.requestString = this.requestString.concat(requestString);
        this.timeout = setTimeout(() => {
            const resolvers = [].concat(this.resolvers);
            const rejecters = [].concat(this.rejecters);
            const definitions = reduce(this.definitions, (reduction, value, key) => {
                    return reduction.concat(`${key}:${value}`);
                }, [])
                .join();

            this.executor({
                    requestString: `${this.type}${definitions ? `(${definitions})` : ''} {${this.requestString.join('')}}`,
                    variableValues: this.variableValues
                })
                .then(response => {
                    while (resolvers.length > 0) {
                        resolvers.shift()(response);
                    }
                })
                .catch(err => {
                    while (rejecters.length > 0) {
                        rejecters.shift()(err);
                    }
                });

            this.setup();
        }, this.wait);

        return new Promise((resolve, reject) => {
            this.resolvers.push(resolve);
            this.rejecters.push(reject);
        });
    }
}