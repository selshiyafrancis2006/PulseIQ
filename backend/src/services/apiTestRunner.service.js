const { checkHttp } = require('./httpCheck.service');

const MAX_STEPS = 10;
const MAX_TIMEOUT_MS = 30_000;
const VARIABLE_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

function getPath(value, path) {
    if (typeof path !== 'string' || !path.trim()) {
        return { found: false };
    }

    let current = value;

    for (const part of path.split('.')) {
        if (
            current === null ||
            current === undefined ||
            !Object.prototype.hasOwnProperty.call(Object(current), part)
        ) {
            return { found: false };
        }

        current = current[part];
    }

    return { found: true, value: current };
}

function interpolate(value, variables) {
    if (typeof value === 'string') {
        return value.replace(VARIABLE_PATTERN, (match, name) => {
            if (!Object.prototype.hasOwnProperty.call(variables, name)) {
                throw new Error('A referenced variable is unavailable');
            }

            const replacement = variables[name];

            if (replacement === null || replacement === undefined) {
                throw new Error('A referenced variable is unavailable');
            }

            return typeof replacement === 'object'
                ? JSON.stringify(replacement)
                : String(replacement);
        });
    }

    if (Array.isArray(value)) {
        return value.map(item => interpolate(item, variables));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                interpolate(item, variables)
            ])
        );
    }

    return value;
}

function validateTest(apiTest) {
    if (!apiTest || !Array.isArray(apiTest.steps)) {
        throw new Error('steps must be an array');
    }

    if (apiTest.steps.length < 1 || apiTest.steps.length > MAX_STEPS) {
        throw new Error(`steps must contain between 1 and ${MAX_STEPS} steps`);
    }

    for (const [index, step] of apiTest.steps.entries()) {
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
            throw new Error(`Step ${index + 1} must be an object`);
        }

        if (typeof step.url !== 'string' || !step.url.trim()) {
            throw new Error(`Step ${index + 1} requires a URL`);
        }

        if (
            typeof step.method !== 'string' ||
            !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(step.method)
        ) {
            throw new Error(`Step ${index + 1} has an unsupported HTTP method`);
        }

        if (
            step.timeout_ms !== undefined &&
            (!Number.isInteger(step.timeout_ms) ||
                step.timeout_ms < 1 ||
                step.timeout_ms > MAX_TIMEOUT_MS)
        ) {
            throw new Error(
                `Step ${index + 1} timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`
            );
        }

        if (
            step.headers !== undefined &&
            (!step.headers || typeof step.headers !== 'object' ||
                Array.isArray(step.headers))
        ) {
            throw new Error(`Step ${index + 1} headers must be an object`);
        }

        if (
            step.assertions !== undefined &&
            (!step.assertions || typeof step.assertions !== 'object' ||
                Array.isArray(step.assertions))
        ) {
            throw new Error(`Step ${index + 1} assertions must be an object`);
        }

        if (
            step.assertions?.status !== undefined &&
            (!Number.isInteger(step.assertions.status) ||
                step.assertions.status < 100 ||
                step.assertions.status > 599)
        ) {
            throw new Error(`Step ${index + 1} has an invalid expected status`);
        }

        if (
            step.assertions?.body !== undefined &&
            (!step.assertions.body ||
                typeof step.assertions.body !== 'object' ||
                Array.isArray(step.assertions.body))
        ) {
            throw new Error(`Step ${index + 1} body assertions must be an object`);
        }

        if (
            step.extract !== undefined &&
            (!step.extract || typeof step.extract !== 'object' ||
                Array.isArray(step.extract))
        ) {
            throw new Error(`Step ${index + 1} extract must be an object`);
        }

        if (step.extract) {
            for (const [name, path] of Object.entries(step.extract)) {
                if (
                    !/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ||
                    typeof path !== 'string' ||
                    !path.trim()
                ) {
                    throw new Error(`Step ${index + 1} has an invalid extraction`);
                }
            }
        }
    }
}

async function runApiTest(apiTest) {
    validateTest(apiTest);

    const variables = Object.create(null);
    const results = [];
    const startedAt = Date.now();
    let failedStep = null;

    for (const [index, step] of apiTest.steps.entries()) {
        const stepStartedAt = Date.now();
        const result = {
            step: index + 1,
            name: typeof step.name === 'string'
                ? step.name.slice(0, 100)
                : `Step ${index + 1}`,
            statusCode: null,
            durationMs: 0,
            passed: false,
            assertions: []
        };

        try {
            const request = {
                url: interpolate(step.url, variables),
                method: step.method.toUpperCase(),
                headers: interpolate(step.headers || {}, variables),
                body: step.body === undefined
                    ? undefined
                    : interpolate(step.body, variables),
                timeout_ms: step.timeout_ms || 10_000
            };

            // checkHttp validates and pins every outbound destination,
            // including redirects. Do not replace its production validator.
            const response = await checkHttp(request);
            result.statusCode = response.statusCode;

            let responseBody = null;
            let parsedJson = false;

            if (typeof response.body === 'string') {
                try {
                    responseBody = JSON.parse(response.body);
                    parsedJson = true;
                } catch {
                    responseBody = response.body;
                }
            }

            let stepPassed = true;

            if (step.assertions?.status !== undefined) {
                const passed = response.statusCode === step.assertions.status;

                result.assertions.push({
                    type: 'status',
                    passed
                });

                if (!passed) stepPassed = false;
            }

            if (step.assertions?.body !== undefined) {
                for (const [path, expected] of Object.entries(
                    step.assertions.body
                )) {
                    const actual = parsedJson
                        ? getPath(responseBody, path)
                        : { found: false };

                    const passed = actual.found &&
                        JSON.stringify(actual.value) === JSON.stringify(expected);

                    result.assertions.push({
                        type: 'body',
                        path,
                        passed
                    });

                    if (!passed) stepPassed = false;
                }
            }

            const pendingVariables = Object.create(null);

            if (step.extract) {
                for (const [name, path] of Object.entries(step.extract)) {
                    const extracted = parsedJson
                        ? getPath(responseBody, path)
                        : { found: false };

                    if (!extracted.found) {
                        result.assertions.push({
                            type: 'extract',
                            path,
                            passed: false
                        });
                        stepPassed = false;
                        break;
                    }

                    // Stage values until every assertion and extraction passes.
                    pendingVariables[name] = extracted.value;
                }
            }

            result.passed = stepPassed;

            if (result.passed) {
                Object.assign(variables, pendingVariables);
            }
        } catch {
            // Do not persist raw errors: they can contain URLs or secrets.
            result.error = 'Request or step processing failed';
            result.passed = false;
        }

        result.durationMs = Date.now() - stepStartedAt;
        results.push(result);

        if (!result.passed) {
            failedStep = index + 1;
            break;
        }
    }

    return {
        status: failedStep === null ? 'passed' : 'failed',
        failedStep,
        durationMs: Date.now() - startedAt,
        results
    };
}

module.exports = { runApiTest, validateTest };


