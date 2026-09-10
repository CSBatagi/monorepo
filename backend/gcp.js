// Import the Compute Engine client library
const computeEngine = require('@google-cloud/compute').v1;
const fs = require('fs');
const path = require('path');

module.exports = class GcpManager {
  constructor() {
    // Path to the credentials file
    const credentialsPath = path.join(__dirname, '..', 'credentials.json');

    // Use environment variables if available, otherwise read from .gcp_parameters file
    if (process.env.CS2_VM_NAME && process.env.CS2_GCP_ZONE) {
      this.vmName = process.env.CS2_VM_NAME;
      this.zone = process.env.CS2_GCP_ZONE;
      console.log(`Using environment variables: VM_NAME=${this.vmName}, GCP_ZONE=${this.zone}`);
    } else {
      // Read GCP parameters from file as fallback
      const gcpParamsPath = path.join(__dirname, '..', '.gcp_parameters');
      const gcpParams = fs.readFileSync(gcpParamsPath, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '')
        .reduce((params, line) => {
          const [key, value] = line.split('=');
          params[key] = value;
          return params;
        }, {});

      this.vmName = gcpParams.GCP_VM_NAME;
      this.zone = gcpParams.GCP_ZONE;
      console.log(`Using .gcp_parameters file: VM_NAME=${this.vmName}, GCP_ZONE=${this.zone}`);
    }

    // Initialize the Compute client
    const projectId = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).project_id;
    this.compute = new computeEngine.InstancesClient({
      projectId: projectId,
      keyFilename: credentialsPath
    });
  }

  async performVmOperation(operationType) {
    try {
      if (this.vmName !== 'cs2-server' || this.zone !== 'europe-west3-c') {
        throw new Error('Refusing to operate on a VM other than the configured CS2 game server');
      }
      if (!['start', 'stop'].includes(operationType)) throw new Error('Invalid VM operation');
      const action = operationType === 'start' ? 'Starting' : 'Stopping';
      console.log(`${action} VM: ${this.vmName} in zone: ${this.zone}`);

      // Get the project ID from the credentials file
      const credentialsPath = path.join(__dirname, '..', 'credentials.json');
      const projectId = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).project_id;

      // Create the request
      const request = {
        project: projectId,
        zone: this.zone,
        instance: this.vmName
      };

      // Perform the VM operation (start or stop)
      const [operation] = await this.compute[operationType](request);

      // Wait for the operation to complete
      const operationsClient = new computeEngine.ZoneOperationsClient({
        projectId: projectId,
        keyFilename: credentialsPath
      });

      await operationsClient.wait({
        operation: operation.name,
        project: projectId,
        zone: this.zone
      });

      const pastTense = operationType === 'start' ? 'started' : 'stopped';
      console.log(`VM ${this.vmName} ${pastTense} successfully`);
      return { success: true, message: `VM ${this.vmName} ${pastTense} successfully` };
    } catch (error) {
      console.error(`Error ${operationType}ing VM:`, error);
      return { success: false, error: error.message };
    }
  }

  async startVm() {
    return this.performVmOperation('start');
  }

  async stopVm() {
    return this.performVmOperation('stop');
  }
}
