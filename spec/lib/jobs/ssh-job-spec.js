// Copyright 2016, EMC, Inc.

'use strict';
var uuid = require('node-uuid');

describe('ssh-job', function() {
    var waterline = { nodes: {}, catalogs: {} },
        mockParser = {},
        Emitter = require('events').EventEmitter,
        mockEncryption = {},
        SshJob,
        sshJob;

    function sshMockGet(eventList, error) {
        var mockSsh = new Emitter();
        mockSsh.events = new Emitter();
        mockSsh.stdout = mockSsh.events;
        mockSsh.events.stderr = new Emitter();
        mockSsh.stderr = mockSsh.events.stderr;
        mockSsh.eventList = eventList;
        mockSsh.error = error;
        mockSsh.exec = function(cmd, callback) {
            callback(this.error, this.events);
        };
        mockSsh.end = function() {
            this.emit('close');
        };
        mockSsh.connect = function() {
            var self = this;
            self.emit('ready');
            _.forEach(this.eventList, function(eventObj) {
                eventObj = _.defaults(eventObj, {event: 'data', source: 'stdout'});
                self[eventObj.source].emit(eventObj.event, eventObj.data);
            });
        };
        return mockSsh;
    }

    before(function() {
        helper.setupInjector([
            helper.require('/lib/jobs/ssh-job.js'),
            helper.di.simpleWrapper(mockParser, 'JobUtils.CommandParser'),
            helper.di.simpleWrapper(mockEncryption, 'Services.Encryption'),
            helper.di.simpleWrapper({Client:function(){}}, 'ssh'),
            helper.require('/lib/jobs/base-job.js'),
            helper.di.simpleWrapper(waterline, 'Services.Waterline')
        ]);
        this.sandbox = sinon.sandbox.create();
        SshJob = helper.injector.get('Job.Ssh');
    });

    describe('_run', function() {
        var sshSettings;
        beforeEach(function() {
            sshJob = new SshJob({}, { target: 'someNodeId' }, uuid.v4());
            waterline.nodes.needByIdentifier = this.sandbox.stub();
            this.sandbox.stub(sshJob, 'sshExec').resolves();
            this.sandbox.stub(sshJob, 'handleResponse').resolves();
            sshSettings = {
                host: 'the remote host',
                port: 22,
                username: 'someUsername',
                password: 'somePassword',
                privateKey: 'a pretty long, encrypted string',
            };
        });

        afterEach(function() {
            this.sandbox.restore();
        });

        it('should execute the given remote commands using credentials'+
        ' from a node and handle the responses', function() {
            sshJob.commands = [
                {command: 'aCommand', catalogOptions: { source: 'test' }},
                {command: 'testCommand'}
            ];
            var node = { sshSettings: sshSettings };
            waterline.nodes.needByIdentifier.resolves(node);
            sshJob.sshExec.onCall(0).resolves({});
            sshJob.sshExec.onCall(1).resolves({});
            return sshJob._run()
            .then(function() {
                expect(sshJob.sshExec).to.have.been.calledTwice;
                expect(sshJob.sshExec).to.have.been.calledWith('aCommand', sshSettings);
                expect(sshJob.sshExec).to.have.been.calledWith('testCommand', sshSettings);
                expect(sshJob.handleResponse).to.have.been.calledOnce;
                expect(sshJob.handleResponse).to.have.been.calledWith([
                    {cmd: 'aCommand', catalogOptions: { source: 'test'}},
                    {cmd: 'testCommand', catalogOptions: undefined }
                ]);
            });
        });
    });

    describe('sshExec', function() {
        var sshSettings,
            testCmd;


        beforeEach(function() {
            sshJob = new SshJob({}, { target: 'someNodeId' }, uuid.v4());
            mockEncryption.decrypt = this.sandbox.stub();
            sshSettings = {
                host: 'the remote host',
                port: 22,
                username: 'someUsername',
                password: 'somePassword',
                privateKey: 'a pretty long, encrypted string',
            };
        });

        it('should return a promise for an object with stdout/err and exit code', function() {
            var events = [
                { data: 'test ' },
                { data: 'string' },
                { event: 'close', data: 0 }
            ];

            return sshJob.sshExec(testCmd, sshSettings, sshMockGet(events))
            .then(function(data) {
                expect(data.stdout).to.equal('test string');
                expect(data.stderr).to.equal(undefined);
                expect(data.exitCode).to.equal(0);
            });
        });

        it('should reject if exit code is not in accepted exit codes', function() {
            var events = [
                {event: 'data', source: 'stderr', data: 'errData' },
                { event: 'close', data: 127 }
            ];
            return expect(
                sshJob.sshExec(testCmd, sshSettings, sshMockGet(events))
            ).to.be.rejected;
        });

        it('should decrypt passwords and private keys', function() {
            var mockClient = sshMockGet([{ event: 'close', data: 0 }]);
            return sshJob.sshExec(testCmd, sshSettings, mockClient)
            .then(function() {
                expect(mockEncryption.decrypt.callCount).to.equal(2);
                expect(mockEncryption.decrypt)
                    .to.have.been.calledWith(sshSettings.password);
                expect(mockEncryption.decrypt)
                    .to.have.been.calledWith(sshSettings.privateKey);
            });
        });

        it('should reject if underlying ssh returns an error', function() {
            var mockClient = sshMockGet(
                [{ event: 'close', data: 0 }],
                new Error('ssh error')
            );

            return expect(sshJob.sshExec(testCmd, sshSettings, mockClient)).to
                .be.rejected;
        });
    });

    describe('catalogUserTasks', function() {
        var catalogableTask, errTask, unmarkedTask, tasksOutput;

        beforeEach(function() {
            sshJob = new SshJob({}, { target: 'someNodeId' }, uuid.v4());
            mockParser.parseTasks = this.sandbox.stub().resolves();
            waterline.catalogs.create = this.sandbox.stub();
            catalogableTask = function() {
                return { data: 'catalog me!', store: true, source: 'test' };
            };
            errTask = function() {
               return { error: new Error('parse failure'), source: 'test' };
            };
            unmarkedTask = function() {
                return { data: 'don\'t catalog me!', source: 'test' };
            };
            tasksOutput = [{ stdout: 'some arbitrary parseable data' }];
        });

        afterEach(function() {
            this.sandbox.restore();
        });

        it('should use the command parser to parse and array of tasks and'+
            'return a Promise for catalogging them', function() {
            mockParser.parseTasks.resolves([catalogableTask(), catalogableTask()]);
            return sshJob.catalogUserTasks(tasksOutput)
            .then(function() {
                expect(waterline.catalogs.create).to.have.been.calledTwice;
            });
        });

        it('should catalog only marked tasks', function() {
            mockParser.parseTasks.resolves([catalogableTask(), unmarkedTask()]);
            return sshJob.catalogUserTasks(tasksOutput)
            .then(function() {
                expect(waterline.catalogs.create).to.have.been.calledOnce;
            });
        });

        it('should not catalog tasks that could not be parsed', function() {
            mockParser.parseTasks.resolves([catalogableTask(), errTask()]);
            return sshJob.catalogUserTasks(tasksOutput)
            .then(function() {
                expect(waterline.catalogs.create).to.have.been.calledOnce;
            });
        });
    });

    describe('handleResponse', function() {
        var testResponse;

        beforeEach(function() {
            sshJob = new SshJob({}, { target: 'someNodeId' }, uuid.v4());
            this.sandbox.stub(sshJob, 'catalogUserTasks').resolves();
            testResponse = [
                { data: 'data', catalogOptions: { source: 'test' } },
                { data: 'data' },
                { data: 'data', catalogOptions: undefined }
            ];
        });

        afterEach(function() {
            this.sandbox.restore();
        });

        it('should filter an array of objects by "catalogOptions" key'+
            ' to feed to catalogUserTasks', function() {

            return sshJob.handleResponse(testResponse)
            .then(function() {
                expect(sshJob.catalogUserTasks).to.have.been.calledOnce;
                expect(sshJob.catalogUserTasks).to.have.been
                    .calledWithExactly([testResponse[0]]);
            });
        });

        it('should catch and bubble up errors in the parsing/catalogging'+
            ' process', function() {
            var err = new Error('catalog error');
            sshJob.catalogUserTasks.rejects(err);
            return expect(sshJob.handleResponse(testResponse)).to.be.rejectedWith(err);
        });
    });

    describe('buildCommands', function() {
        var commandObject;

        beforeEach(function() {
            sshJob = new SshJob({}, { target: 'someNodeId' }, uuid.v4());
            commandObject = {
                    command: 'command',
                    retries: 3,
                    catalog: { format: 'json', source: 'test' }
                };
        });
        it('should return an array of command objects from '+
            'an array of input objects and/or strings', function() {
            var commands = ['stringCommand', commandObject ];

            expect(sshJob.buildCommands(commands)).to.deep.equal([
                { command: 'stringCommand' },
                {
                    command: 'command', retries: 3,
                    catalogOptions: { source: 'test', format: 'json' }
                }
            ]);
        });

        it('should err on unsupported options', function() {
            var commands = _.map(['downloadUrl', 'acceptedResponseCodes', 'junk'],
            function(option) {
                var optObj = _.cloneDeep(commandObject);
                optObj[option] = 'someUnsupportedOptionData';
                return optObj;
            });
            _.forEach(commands, function(command) {
                expect(sshJob.buildCommands.bind(sshJob, command)).to
                .throw(/not supported/);
            });
        });
    });
});
