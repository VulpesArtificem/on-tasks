// Copyright 2016, EMC, Inc.

'use strict';

var di = require('di');
module.exports = sshJobFactory;

//var Client = require('ssh2').Client;

di.annotate(sshJobFactory, new di.Provide('Job.Ssh'));
di.annotate(sshJobFactory, new di.Inject(
    'Job.Base',
    'JobUtils.CommandParser',
    'Util',
    'Logger',
    'Assert',
    'Promise',
    'Services.Waterline',
    'Services.Encryption',
    'ssh',
    '_'
));

function sshJobFactory(
    BaseJob,
    parser,
    util,
    Logger,
    assert,
    Promise,
    waterline,
    cryptService,
    ssh,
    _
) {
    var logger = Logger.initialize(sshJobFactory);
    var Client = ssh.Client;
    function SshJob(options, context, taskId) {
        SshJob.super_.call(this, logger, options, context, taskId);
        assert.string(this.context.target);
        this.nodeId = this.context.target;
        this.acceptedCodes = (options.acceptedCodes || []).concat(0);
        this.commands = this.buildCommands(options.commands);
        assert.arrayOfObject(this.commands);
    }
    util.inherits(SshJob, BaseJob);

    SshJob.prototype._run = function run() {
        var self = this;
        return waterline.nodes.needByIdentifier(self.nodeId)
        .then(function(node) {
            return Promise.reduce(self.commands, function(results, commandData) {
                return self.sshExec(commandData.command, node.sshSettings, new Client())
                .then(function(result) {
                    result.catalogOptions = commandData.catalogOptions;
                    result.cmd = commandData.command; //for parser matching
                    return results.concat([result]);
                });
            }, []);
        })
        .then(self.handleResponse.bind(self))
        .then(function() {
            self._done();
        })
        .catch(self._done.bind(self));
    };

    SshJob.prototype.handleResponse = function(results) {
        var self = this;

        logger.debug("Received remote command output from node.", {
            id: self.nodeId,
        });

        var catalogTasks = _.filter(results, function(result) {
            logger.debug('task result', {data:result});
            return  _.has(result, 'catalogOptions') && result.catalogOptions;
        });

        return self.catalogUserTasks(catalogTasks)
        .catch(function(err) {
            logger.error("Job error processing catalog output.", {
                error: err,
                id: self.nodeId,
                taskContext: self.context
            });
            throw err;
        });
    };

    SshJob.prototype.catalogUserTasks = function(tasks) {
        var self = this;

        return parser.parseUnknownTasks(tasks)
        .spread(function() {
            return Promise.map(Array.prototype.slice.call(arguments), function(result) {
                if (result.error) {
                    logger.error("Failed to parse data for " +
                        result.source + ', ' + result.error,
                        { error: result });
                } else if (result.store) {
                    return waterline.catalogs.create({
                        node: self.nodeId,
                        source: result.source || 'unknown',
                        data: result.data
                    });
                } else {
                    logger.info("Catalog result for " + result.source +
                        " has not been marked as significant. Not storing.");
                }
            });
        });
    };

    SshJob.prototype.sshExec = function(command, sshSettings, sshClient) {
        var self = this;
        return new Promise(function(resolve, reject) {

            var ssh = sshClient;
            var sshData = {};
            ssh.on('ready', function() {
                ssh.exec(command, function(err, stream) {
                    if (err) { reject(err); }
                    stream.on('close', function(code) {
                        sshData.exitCode = code;
                        ssh.end();
                    }).on('data', function(data) {
                        sshData.stdout = ( sshData.stdout || '' ) + data.toString();
                    }).stderr.on('data', function(data) {
                        sshData.stderr = ( sshData.stderr || '' ) + data.toString();
                    });
                });
            }).on('close', function() {

                if (!_.contains(self.acceptedCodes, sshData.exitCode)) {
                    reject(sshData);
                }
                resolve(sshData);
            });
            ssh.connect({
                host: sshSettings.host,
                port: 22,
                username: sshSettings.user,
                password: cryptService.decrypt(sshSettings.password),
                privateKey: cryptService.decrypt(sshSettings.privateKey)
            });
        });
    };
    /**
     * Transforms the command option json from a task definition to a json schema
     * consumed by the RemoteUtil ssh utility
     *
     * @example
     * Sample input:
     *  [
     *      {
     *          command: 'sudo lshw -json',
     *          retries: 3,
     *          catalog: { format: 'json', source: 'lshw user' }
     *      }
     *  ]
     *
     * Sample output:
     *  [
     *      {
     *          command: 'sudo lshw -json',
     *          catalog: true,
     *          retries: 3,
     *          catalogOptions: {
     *              source: 'lshw user',
     *              format: 'json'
     *          }
     *      }
     *  ]
     *
     * @memberOf SshJob
     * @function
     */
    SshJob.prototype.buildCommands = function(commands) {
        return _.map(_.flatten([commands]), function(cmd) {
            if (typeof cmd === 'string') {
                return { command: cmd };
            }
            return _.transform(cmd, function(cmdObj, v, k) {
                if (k === 'catalog') {
                    cmdObj.catalogOptions = {
                        source: v.source,
                        format: v.format
                    };
                } else if (k === 'command') {
                    cmdObj.command = v;
                } else if (k === 'retries') {
                    cmdObj.retries = v;
                } else if (k === 'downloadUrl') {
                    throw new Error('downloadUrl option is not supported yet');
                } else if (k === 'acceptedResponseCodes') {
                    throw new Error('acceptedResponseCodes option is not supported yet');
                } else if ( !_.contains(['source', 'format'], k) ){
                    throw new Error(k + ' option is not supported');
                }
            }, {});
        });
    };

    return SshJob;
}

