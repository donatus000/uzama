
# Uzama Access Control Contract

A Clarity smart contract that implements a time-based access control system where users can purchase temporary access to resources using STX tokens.

## Features

- **Resource Management**: Contract owner can configure multiple resources with individual pricing
- **Time-based Access**: Access automatically expires after a specified number of blocks
- **Payment Processing**: Secure STX token transfers with proper error handling
- **Access Verification**: Read-only functions to check current access status

## Core Functions

### Owner Functions

#### `set-resource-config`
```clarity
(set-resource-config resource price-per-block min-period max-period)
```
- **Purpose**: Configure a resource with pricing and period constraints
- **Access**: Contract owner only
- **Parameters**:
  - `resource`: Resource identifier (max 64 characters)
  - `price-per-block`: STX cost per block of access
  - `min-period`: Minimum blocks that can be purchased
  - `max-period`: Maximum blocks that can be purchased

#### `withdraw`
```clarity
(withdraw amount)
```
- **Purpose**: Withdraw STX tokens from contract
- **Access**: Contract owner only
- **Parameters**: `amount` - STX amount to withdraw

### User Functions

#### `buy-access`
```clarity
(buy-access resource period)
```
- **Purpose**: Purchase time-limited access to a resource
- **Payment**: Automatically calculated as `price-per-block × period`
- **Parameters**:
  - `resource`: Resource to access
  - `period`: Number of blocks to purchase access for

### Read-Only Functions

#### `has-access`
```clarity
(has-access resource user)
```
- **Returns**: `true` if user has valid (non-expired) access, `false` otherwise

#### `get-resource-config`
```clarity
(get-resource-config resource)
```
- **Returns**: Resource configuration including pricing and period limits

#### `get-access-expiry`
```clarity
(get-access-expiry resource user)
```
- **Returns**: Block height when user's access expires, or `none` if no access

## Data Structures

### Resource Configuration
```clarity
{
  price-per-block: uint,
  min-period: uint,
  max-period: uint,
  active: bool
}
```

### Access Record
```clarity
{
  expiry: uint  // Block height when access expires
}
```

## Error Codes

- `u100`: Invalid price (must be > 0)
- `u101`: Invalid period (outside min/max range)
- `u102`: Empty resource name
- `u103`: Payment transfer failed
- `u104`: Not authorized (owner-only function)
- `u105`: Resource not found or inactive
- `u106`: Insufficient payment

## Usage Example

```clarity
;; 1. Owner configures a resource (10 STX per block, 100-5000 block range)
(contract-call? .uzama set-resource-config "premium-content" u10 u100 u5000)

;; 2. User purchases 1000 blocks of access (costs 10,000 STX)
(contract-call? .uzama buy-access "premium-content" u1000)

;; 3. Check access status
(contract-call? .uzama has-access "premium-content" 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)
```
