import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const contractName = "uzama";
const defaultResource = "resource-a";
const pricePerBlock = 10n;
const minPeriod = 2n;
const maxPeriod = 20n;

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const user1 = accounts.get("wallet_1")!;
const user2 = accounts.get("wallet_2")!;

const configureResource = (
  resource = defaultResource,
  price = pricePerBlock,
  min = minPeriod,
  max = maxPeriod,
  sender = deployer,
) =>
  simnet.callPublicFn(
    contractName,
    "set-resource-config",
    [Cl.stringAscii(resource), Cl.uint(price), Cl.uint(min), Cl.uint(max)],
    sender,
  );

const setResourceActive = (resource = defaultResource, active: boolean, sender = deployer) =>
  simnet.callPublicFn(
    contractName,
    "set-resource-active",
    [Cl.stringAscii(resource), Cl.bool(active)],
    sender,
  );

const buyAccess = (resource = defaultResource, period = minPeriod + 1n, sender = user1) =>
  simnet.callPublicFn(
    contractName,
    "buy-access",
    [Cl.stringAscii(resource), Cl.uint(period)],
    sender,
  );

const extendAccess = (resource = defaultResource, period = minPeriod, sender = user1) =>
  simnet.callPublicFn(
    contractName,
    "extend-access",
    [Cl.stringAscii(resource), Cl.uint(period)],
    sender,
  );

const getResourceConfig = (resource = defaultResource, caller = deployer) =>
  simnet.callReadOnlyFn(contractName, "get-resource-config", [Cl.stringAscii(resource)], caller);

const getAccessExpiry = (resource = defaultResource, user = user1) =>
  simnet.callReadOnlyFn(
    contractName,
    "get-access-expiry",
    [Cl.stringAscii(resource), Cl.standardPrincipal(user)],
    user,
  );

const getRemainingAccess = (resource = defaultResource, user = user1) =>
  simnet.callReadOnlyFn(
    contractName,
    "get-remaining-access",
    [Cl.stringAscii(resource), Cl.standardPrincipal(user)],
    user,
  );

const hasAccess = (resource = defaultResource, user = user1) =>
  simnet.callReadOnlyFn(
    contractName,
    "has-access",
    [Cl.stringAscii(resource), Cl.standardPrincipal(user)],
    user,
  );

const getContractBalance = () => simnet.getDataVar(contractName, "contract-balance");

describe("set-resource-config", () => {
  it("allows owner to configure and stores values", () => {
    const response = configureResource();
    expect(response.result).toBeOk(Cl.bool(true));

    const { result: config } = getResourceConfig();
    expect(config).toBeSome(
      Cl.tuple({
        "price-per-block": Cl.uint(pricePerBlock),
        "min-period": Cl.uint(minPeriod),
        "max-period": Cl.uint(maxPeriod),
        active: Cl.bool(true),
      }),
    );
  });

  it("rejects non-owner updates", () => {
    const response = configureResource(defaultResource, pricePerBlock, minPeriod, maxPeriod, user1);
    expect(response.result).toBeErr(Cl.uint(104));
  });

  it("validates price and period bounds", () => {
    const zeroPrice = configureResource(defaultResource, 0n, minPeriod, maxPeriod);
    expect(zeroPrice.result).toBeErr(Cl.uint(100));

    const invalidPeriod = configureResource(defaultResource, pricePerBlock, 5n, 2n);
    expect(invalidPeriod.result).toBeErr(Cl.uint(101));
  });
});

describe("set-resource-active", () => {
  it("fails when resource does not exist", () => {
    const response = setResourceActive("unknown", true);
    expect(response.result).toBeErr(Cl.uint(105));
  });

  it("toggles active flag without changing pricing", () => {
    configureResource();

    const deactivate = setResourceActive(defaultResource, false);
    expect(deactivate.result).toBeOk(Cl.bool(true));

    const inactiveConfig = getResourceConfig().result;
    expect(inactiveConfig).toBeSome(
      Cl.tuple({
        "price-per-block": Cl.uint(pricePerBlock),
        "min-period": Cl.uint(minPeriod),
        "max-period": Cl.uint(maxPeriod),
        active: Cl.bool(false),
      }),
    );

    const reactivate = setResourceActive(defaultResource, true);
    expect(reactivate.result).toBeOk(Cl.bool(true));

    const activeConfig = getResourceConfig().result;
    expect(activeConfig).toBeSome(
      Cl.tuple({
        "price-per-block": Cl.uint(pricePerBlock),
        "min-period": Cl.uint(minPeriod),
        "max-period": Cl.uint(maxPeriod),
        active: Cl.bool(true),
      }),
    );
  });
});

describe("buy-access", () => {
  it("rejects periods outside configured bounds", () => {
    configureResource();

    const tooShort = buyAccess(defaultResource, minPeriod - 1n);
    expect(tooShort.result).toBeErr(Cl.uint(101));

    const tooLong = buyAccess(defaultResource, maxPeriod + 1n);
    expect(tooLong.result).toBeErr(Cl.uint(101));
  });

  it("rejects purchases when resource is inactive", () => {
    configureResource();
    setResourceActive(defaultResource, false);

    const attempt = buyAccess(defaultResource, minPeriod + 1n);
    expect(attempt.result).toBeErr(Cl.uint(105));
  });

  it("sets expiry, remaining access, and balance on purchase", () => {
    configureResource();
    const period = 5n;
    const pricePaid = pricePerBlock * period;

    const response = buyAccess(defaultResource, period);
    expect(response.result).toBeOk(Cl.bool(true));

    const expectedExpiry = BigInt(simnet.blockHeight) + period;
    const expiry = getAccessExpiry().result;
    expect(expiry).toBeSome(Cl.uint(expectedExpiry));

    const remaining = getRemainingAccess().result;
    expect(remaining).toBeSome(Cl.uint(period));

    const accessStatus = hasAccess().result;
    expect(accessStatus).toBeBool(true);

    const balance = getContractBalance();
    expect(balance).toBeUint(pricePaid);
  });
});

describe("extend-access", () => {
  it("requires existing access", () => {
    configureResource();
    const response = extendAccess(defaultResource, minPeriod + 1n);
    expect(response.result).toBeErr(Cl.uint(107));
  });

  it("extends from current expiry when still valid", () => {
    configureResource();
    const initialPeriod = 6n;
    const additionalPeriod = 3n;

    const firstPurchase = buyAccess(defaultResource, initialPeriod);
    expect(firstPurchase.result).toBeOk(Cl.bool(true));
    const initialExpiry = BigInt(simnet.blockHeight) + initialPeriod;

    const extendTx = extendAccess(defaultResource, additionalPeriod);
    expect(extendTx.result).toBeOk(Cl.bool(true));

    const expectedExpiry = initialExpiry + additionalPeriod;
    const expiry = getAccessExpiry().result;
    expect(expiry).toBeSome(Cl.uint(expectedExpiry));

    const balance = getContractBalance();
    const totalPaid = pricePerBlock * (initialPeriod + additionalPeriod);
    expect(balance).toBeUint(totalPaid);
  });

  it("extends from current block height when access expired", () => {
    configureResource();
    const initialPeriod = minPeriod;
    const additionalPeriod = 4n;

    buyAccess(defaultResource, initialPeriod);

    simnet.mineEmptyBlocks(Number(initialPeriod + 1n));
    const expiredStatus = hasAccess().result;
    expect(expiredStatus).toBeBool(false);

    const extendTx = extendAccess(defaultResource, additionalPeriod);
    expect(extendTx.result).toBeOk(Cl.bool(true));

    const expectedExpiry = BigInt(simnet.blockHeight) + additionalPeriod;
    const expiry = getAccessExpiry().result;
    expect(expiry).toBeSome(Cl.uint(expectedExpiry));
  });
});

describe("withdraw", () => {
  it("only allows owner to withdraw and validates amount", () => {
    const zeroAmount = simnet.callPublicFn(contractName, "withdraw", [Cl.uint(0n)], deployer);
    expect(zeroAmount.result).toBeErr(Cl.uint(108));

    const unauthorized = simnet.callPublicFn(contractName, "withdraw", [Cl.uint(1n)], user1);
    expect(unauthorized.result).toBeErr(Cl.uint(104));
  });

  it("blocks withdrawals larger than balance", () => {
    configureResource();
    const period = 3n;
    buyAccess(defaultResource, period);

    const overdraw = simnet.callPublicFn(contractName, "withdraw", [Cl.uint(100000n)], deployer);
    expect(overdraw.result).toBeErr(Cl.uint(109));
  });

  it("allows owner to withdraw available balance", () => {
    configureResource();
    const period = 4n;
    const pricePaid = pricePerBlock * period;
    buyAccess(defaultResource, period);

    const withdrawAmount = pricePaid - pricePerBlock;
    const withdrawTx = simnet.callPublicFn(
      contractName,
      "withdraw",
      [Cl.uint(withdrawAmount)],
      deployer,
    );
    expect(withdrawTx.result).toBeOk(Cl.bool(true));

    const remainingBalance = getContractBalance();
    expect(remainingBalance).toBeUint(pricePaid - withdrawAmount);
  });
});
