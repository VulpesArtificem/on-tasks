// Copyright 2015, EMC, Inc.

module.exports = {
    friendlyName: 'Install OS',
    injectableName: 'Task.Base.Os.Install',
    runJob: 'Job.Os.Install',
    requiredOptions: [
        'profile'
    ],
    requiredProperties: {
        'power.state': 'reboot'
    },
    properties: {
        os: {
            type: 'install'
        }
    }
};
