// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "./BaseModule.sol";
import "./IWallet.sol";
import "./IModuleRegistry.sol";

contract Wallet is IWallet, Initializable {
    // Events
    event Deposited(address from, uint value, bytes data);
    event SafeModeActivated(address msgSender);
    event AuthorisedModule(address indexed module, bool value);
    event Received(uint indexed value, address indexed sender, bytes data);
    event Invoked(address from, address to, uint value, bytes data);
    event RawInvoked(address from, address to, uint value, bytes data);
    event OwnerReplaced(address _newOwner);

    /*
     * We classify three kinds of selectors used in _setLock to distinguish different types of locks:
     * 1.SignerSelector is calculated from SecurityModule.addSigner.selector, representing the locks added by these three functions: 
     * addSigner, replaceSigner and removeSigner.
     * 2.TransactionSelector is calculated from TransactionModule.executeLargeTransaction.selector, representing the lock added by executeLargeTransaction.
     * 3.GlobalSelector is calculated from SecurityModule.lock.selector, representing the lock added by lock.
     * The difference between 3 and 1&2 is that when users trigger SecurityModule's lock funtion, they want to actively lock, 
     * but when they triggered addSigner, replaceSigner, removeSigner or executeLargeTransaction, the wallet is locked because 
     * We don't want users to trigger these actions too often for security reasons.
     */
    bytes4 internal constant SignerSelector = 0x2239f556;
    bytes4 internal constant TransactionSelector = 0x8279b062;
    bytes4 internal constant GlobalSelector = 0xf435f5a7;

    // Public fields
    address public override owner;
    uint public override modules;

    // Internal fields
    uint constant SEQUENCE_ID_WINDOW_SIZE = 10;
    uint[10] recentSequenceIds_;

    // locks
    mapping (bytes4 => uint64) internal locks;

     // The authorised modules
    mapping (address => bool) public override authorised;

     /**
     * @notice Throws if the sender is not an authorised module.
     */
    modifier onlyModule {
        require(authorised[msg.sender], "W: must be module");
        _;
    }
    modifier onlyModuleOrOwner {
        require(authorised[msg.sender] || msg.sender == owner, "W: must be owner or module");
        _;
    } 

    modifier onlyRegisteredModule(address _moduleRegistry) {
        require(IModuleRegistry(_moduleRegistry).isRegisteredModule(msg.sender), "W: module is not registered");
        _;
    }

    /**
     * Modifier that will check if sender is owner
     */
    modifier onlySelf() {
        require(msg.sender == address(this), "only self");
        _;
    }

    modifier onlyOwner {
        require(msg.sender == owner, "W: must be owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * Set up a simple multi-sig wallet by specifying the signers allowed to be used on this wallet.
     * 2 signers will be required to send a transaction from this wallet.
     * Note: The sender is NOT automatically added to the list of signers.
     * Signers CANNOT be changed once they are set
     *
     * @param _modules All modules to authrized by wallet
     * @param _data All modules to authrized by wallet
     */
    function initialize(address[] calldata _modules, bytes[] calldata _data) public initializer {
        require(owner == address(0), "W: wallet already initialized");
        require(_modules.length > 0 && _modules.length == _data.length, 
                "W: empty modules or not matched data");
        modules = _modules.length;
        owner = msg.sender;
        for (uint256 i = 0; i < _modules.length; i++) {
            require(authorised[_modules[i]] == false, "Module is already added");
            authorised[_modules[i]] = true;
            IModule(_modules[i]).init(address(this), _data[i]);  // uncomment will make test/proxy.test.ts failed
            emit AuthorisedModule(_modules[i], true);
        }
        if (address(this).balance > 0) {
            emit Received(address(this).balance, address(0), "");
        }
    }

    /**
     * Upgrade model or remove model for wallet
     */
    function authoriseModule(address _moduleRegistry, address _module, bool _value, bytes calldata _data) external override onlyRegisteredModule(_moduleRegistry) {
        if (authorised[_module] != _value) {
            emit AuthorisedModule(_module, _value);
            if (_value == true) {
                modules += 1;
                authorised[_module] = true;
                IModule(_module).init(address(this), _data);
            } else {
                modules -= 1;
                require(modules > 0, "BW: cannot remove last module");
                IModule instanceModule = IModule(_module);
                instanceModule.removeModule(address(this));
                delete authorised[_module];    
            }
        }
    }

    /**
     * @notice Helper method to check the wallet's lock situation.
     * Refer to the permission flag of linux => 
     * 4: locked by signer related operation 
     * 2: locked by large tx operation 
     * 1: locked globally
     */
    function isLocked() external view override returns (uint) {
        uint lockFlag = 0;
        if (locks[SignerSelector] > uint64(block.timestamp)) {
            lockFlag += 4;
        } 
        if (locks[TransactionSelector] > uint64(block.timestamp)) {
            lockFlag += 2;
        } 
        if (locks[GlobalSelector] > uint64(block.timestamp)) {
            lockFlag += 1;
        }
        return lockFlag;
    }

    /**
     * @notice Lock the wallet
     */
    function setLock(uint256 _releaseAfter, bytes4 _locker) external override onlyModule {
        locks[_locker] = uint64(_releaseAfter);
    }

    function replaceOwner(address _newOwner) external override onlyModule {
        require(_newOwner != address(0), "W: invalid newOwner");
        owner = _newOwner;
        emit OwnerReplaced(_newOwner);
    }

    /**
    * Gets called when a transaction is received without calling a method
    */
    fallback() external payable {
        if (msg.value > 0) {
            // Fire deposited event if we are receiving funds
            emit Deposited(msg.sender, msg.value, msg.data);
        }
    }

    /**
     * Verify that the sequence id has not been used before and inserts it. Throws if the sequence ID was not accepted.
     * We collect a window of up to 10 recent sequence ids, and allow any sequence id that is not in the window and
     * greater than the minimum element in the window.
     * @param sequenceId to insert into array of stored ids
     */
    function tryInsertSequenceId(uint sequenceId) internal {
        // Keep a pointer to the lowest value element in the window
        uint lowestValueIndex = 0;
        for (uint i = 0; i < SEQUENCE_ID_WINDOW_SIZE; i++) {
            // This sequence ID has been used before. Disallow!
            require (recentSequenceIds_[i] != sequenceId, "W: the sequence ID has been used");
            if (recentSequenceIds_[i] < recentSequenceIds_[lowestValueIndex]) {
                lowestValueIndex = i;
            }
        }
        // The sequence ID being used is lower than the lowest value in the window
        // so we cannot accept it as it may have been used before
        require(sequenceId >= recentSequenceIds_[lowestValueIndex],
                "W: the sequence ID being used is lower thatn the lowest value");

        // Block sequence IDs which are much higher than the lowest value
        // This prevents people blocking the contract by using very large sequence IDs quickly
        require(sequenceId <= (recentSequenceIds_[lowestValueIndex] + 10000),
                "W: block sequnece ID are much higer than the lowest value");
        recentSequenceIds_[lowestValueIndex] = sequenceId;
    }

    /**
     * Gets the next available sequence ID for signing when using executeAndConfirm
     * returns the sequenceId one higher than the highest currently stored
     */
    function getNextSequenceId() public view returns (uint) {
        uint highestSequenceId = 0;
        for (uint i = 0; i < SEQUENCE_ID_WINDOW_SIZE; i++) {
            if (recentSequenceIds_[i] > highestSequenceId) {
                highestSequenceId = recentSequenceIds_[i];
            }
        }
        return highestSequenceId + 1;
    }

    /**
     * @notice Performs a generic transaction.
     * @param _target The address for the transaction.
     * @param _value The value of the transaction.
     * @param _data The data of the transaction.
     * @param _expireTime The data of the transaction.
     * @param _sequenceId The data of the transaction.
     */
    function invoke(address _target, uint _value, bytes calldata _data,
                    uint _expireTime, uint _sequenceId
                   ) external override onlyModule returns (bytes memory _result) {
        require(_target != address(this), "W: cann't call itself");
        bool success;
        require(_expireTime >= block.timestamp, "Transaction expired");

        tryInsertSequenceId(_sequenceId);
        (success, _result) = _target.call{value: _value}(_data);
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit Invoked(msg.sender, _target, _value, _data);
    }

    function raw_invoke(address _target, uint _value, bytes calldata _data
                   ) external override onlyModule returns (bytes memory _result) {
        require(_target != address(this), "W: cann't call itself");
        bool success;
        (success, _result) = _target.call{value: _value}(_data);
        if (!success) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
        emit RawInvoked(msg.sender, _target, _value, _data);
    }
}
