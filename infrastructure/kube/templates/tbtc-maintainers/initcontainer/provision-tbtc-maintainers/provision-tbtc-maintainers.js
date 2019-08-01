const fs = require('fs');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const concat = require('concat-stream');
const Web3 = require('web3');

// ETH host info
const ethHost = process.env.ETH_HOSTNAME;
const ethWsPort = process.env.ETH_WS_PORT;
const ethRpcPort = process.env.ETH_RPC_PORT;
const ethNetworkId = process.env.ETH_NETWORK_ID;

/*
We override transactionConfirmationBlocks and transactionBlockTimeout because they're
25 and 50 blocks respectively at default.  The result of this on small private testnets
is long wait times for scripts to execute.
*/
const web3_options = {
    defaultBlock: 'latest',
    defaultGas: 4712388,
    transactionBlockTimeout: 25,
    transactionConfirmationBlocks: 3,
    transactionPollingTimeout: 480
};
const web3 = new Web3(new Web3.providers.HttpProvider(ethHost + ':' + ethRpcPort), null, web3_options);

/*
Each <contract.json> file is sourced directly from the InitContainer.  Files are generated by
Truffle during contract and copied to the InitContainer image via Circle.
*/

// keepRandomBeaconService, only contract address for config file create
const tbtcSystemJsonFile = '/tmp/TBTCSystem.json';
const tbtcSystemParsed = JSON.parse(fs.readFileSync(tbtcSystemJsonFile));
const tbtcSystemContractAddress = tbtcSystemParsed.networks[ethNetworkId].address;

async function provisionTbtcMaintainers() {

  try {

    console.log('###########  Provisioning tbtc-maintainers! ###########');
    console.log('\n<<<<<<<<<<<< Setting Up Operator Account ' + '>>>>>>>>>>>>');

    let operatorEthAccountPassword = process.env.TBTC_MAINTAINERS_ETH_ACCOUNT_PASSWORD;
    let operatorAccount = await createOperatorEthAccount('operator');
    var operator = operatorAccount['address'];

    await createOperatorEthAccountKeyfile(operatorAccount['privateKey'], operatorEthAccountPassword);

    // We wallet add to make the local account available to web3 functions in the script.
    await web3.eth.accounts.wallet.add(operatorAccount['privateKey']);
    
    // Eth account that contracts are migrated against.
    let contractOwner = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
    // Eth account that's both miner and coinbase on internal testnet
    let purse = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;

    console.log('\n<<<<<<<<<<<< Unlocking Contract Owner Account ' + contractOwner + ' >>>>>>>>>>>>');
    await unlockEthAccount(contractOwner, process.env.TBTC_MAINTAINERS_ETH_ACCOUNT_PASSWORD);   

    console.log('\n<<<<<<<<<<<< Funding Operator Account ' + operator + ' >>>>>>>>>>>>');
    await fundOperatorAccount(operator, purse, '1');

    console.log('\n<<<<<<<<<<<< Creating tbtc-maintainers Config File >>>>>>>>>>>>');
    await createTbtcMaintainersConfig(operatorAccount['privateKey']);

    console.log("\n########### tbtc-maintainers Provisioning Complete! ###########");
  }
  catch(error) {
    console.error(error.message);
    throw error;
  }
};

async function createOperatorEthAccount(accountName) {

  let ethAccount = await web3.eth.accounts.create();

  // We write to a file for later passage to the tbtc-maintainers container
  fs.writeFile('/mnt/tbtc-maintainers/config/eth_account_address', ethAccount['address'], (error) => {
    if (error) throw error;
  });
  console.log(accountName + ' Account '  + ethAccount['address'] + ' Created!');
  return ethAccount;
};

// We are creating a local account.  We must manually generate a keyfile for use by the tbtc-maintainers
async function createOperatorEthAccountKeyfile(ethAccountPrivateKey, ethAccountPassword) {

  let ethAccountKeyfile = await web3.eth.accounts.encrypt(ethAccountPrivateKey, ethAccountPassword);

  // We write to a file for later passage to the tbtc-maintainers container
  fs.writeFile('/mnt/tbtc-maintainers/config/eth_account_keyfile', JSON.stringify(ethAccountKeyfile), (error) => {
    if (error) throw error;
  });
  console.log('Keyfile generated!');
};

async function unlockEthAccount(ethAccount, ethAccountPassword) {

  await web3.eth.personal.unlockAccount(ethAccount, ethAccountPassword, 150000);

  console.log('Account ' + ethAccount + ' unlocked!');
};

async function fundOperatorAccount(operator, purse, etherToTransfer) {

  let transferAmount = web3.utils.toWei(etherToTransfer, "ether")

  console.log("Funding account " + operator + " with " + transferAmount + " wei from purse " + purse);
  await web3.eth.sendTransaction({from:purse, to:operator, value:transferAmount});
  console.log("Account " + operator + " funded!");
}

async function createTbtcMaintainersConfig(operatorPrivateKey) {

  fs.createReadStream('/tmp/tbtc-maintainers-template.toml', 'utf8').pipe(concat(function(data) {
    let parsedConfigFile = toml.parse(data);

    parsedConfigFile.ethereum.URL = ethHost.replace('http://', 'ws://') + ':' + ethWsPort;
    parsedConfigFile.ethereum.PrivateKey = operatorPrivateKey.replace('0x', '')
    parsedConfigFile.ethereum.ContractAddresses.TBTCSystem = tbtcSystemContractAddress;

    fs.writeFile('/mnt/tbtc-maintainers/config/tbtc-maintainers-config.toml', tomlify.toToml(parsedConfigFile), (error) => {
      if (error) throw error;
    });
  }));
  
  console.log("tbtc-maintainers config written to /mnt/tbtc-maintainers/config/tbtc-maintainers-config.toml");
};

provisionTbtcMaintainers().catch(error => {
  console.error(error);
  process.exit(1);
});

