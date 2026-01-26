#!/bin/bash
# Complete the reveal transaction with a new funding UTXO
# The commit tx is already in mempool, we just need to add funding

set -e

# Original reveal tx witness data (from commit output spend)
COMMIT_TXID="8339c04480269fdae4114a25f250af4279fb604aeedfd7a048ae6d7d18beca1a"
COMMIT_VOUT=0
COMMIT_VALUE=499778

# Signature (SIGHASH_ALL | ANYONECANPAY - valid for any input set)
SIGNATURE="d2a409dd957cf4a8062246f8d4bdd28e0af3aec0ebdd814305edce76c013926799e6c77faa2cfc324fabc5b8e0519562d72f67a6e06b78c2066dbeaf786c226e81"

# Spell script (from witness)
SPELL_SCRIPT="0063057370656c6c4d080282a36776657273696f6e08627478a1646f75747381a100a5657072696365a46570726963651b000009184e72a0006f74696d657374616d705f626c6f636b0066736f75726365644d6f636b6a636f6e666964656e63651864686f70657261746f72982018d5184f18a8183118ac18191857184c18550318f118cb18d5051893184a0b18ab183c18ee0000000000000000000000006561646d696e982018d5184f18a8183118ac18191857184c18550318f118cb18d5051893184a0b18ab183c18ee0000000000000000000000006969735f616374697665f5706c6173745f76616c69645f70726963651b000009184e72a000716170705f7075626c69635f696e70757473a183616e98201860186f18b418c518450d185e18ac0718b3161866184d18281888189118c818281318a718e50418f518a418a81869051829188818f50418a9982018b4184d18b0187a18c1186918770418ea1871187018f418e8185718c50c1845184518f018de0018df18cc111883185d18c618ef18b018c2187c1832f699010418a41859184c18590618a218e818fb18f718c018fe18b1183a18f418c418d818f918fe1823184f1846185918c0185c1894189018b118fa183018da18731018e11898184906182d18ca188718d7184818ea18b5189318c80018ca18371718d71889188e1886182c18801825181f185104184e189a18890418290b18db18eb18d50418674d6601182318e61898186308186b18bb184418da17181d186418a9188b18da186818d318b2187a1831182018ab18801885187d04185418c11876189f18221854181d1418f9182518be18c818d918fb18c41823181e188218b418c51819189a1827188c18e6187c188b18fb187a181f187a18a518ba1856189518921822189b188c18ac182d18211870187d187a18f3186009188c0518ef185a18b718b218af18a2183d18a418b718f418cb18f20c0a18bc1852188c18e7181a18e609185118d018a518c1187118b11888183918f918c91888181f18e218ab182e18f4186c11070a18e918341894189a1828010b182110181c188e0718621821188e185318ca0118e5189318ea18d7182218ba18a918ac18a9183d1820181a18d518a0185018a518a4188918641835182318aa18680318c8187c18d7184c18e617186118b20518b1183b18eb1885189218e018c0182718d5188e0918d3183b189b18c0185218a30f18bf184918a21824682098e5298e257914893c03b53478aa43df025def11e6a6820a114427d0f9c2e5c5ac"

# Control block
CONTROL_BLOCK="c098e5298e257914893c03b53478aa43df025def11e6a6820a114427d0f9c2e5c5"

# Required outputs (from original reveal tx - CANNOT be changed due to SIGHASH_ALL)
# Output 0: 547 sats (charm NFT)
# Output 1: 1434 sats (charms protocol)
# Output 2: 996853 sats (change)
TOTAL_OUTPUTS=998834

# Check for new funding UTXO
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <new_funding_txid:vout> <value_in_sats>"
    echo ""
    echo "Example: $0 abc123...def:0 500000"
    echo ""
    echo "The commit tx (${COMMIT_TXID}) is in mempool."
    echo "You need a new funding UTXO with at least 500000 sats."
    echo ""
    echo "Get testnet4 coins from: https://faucet.testnet4.dev/"
    echo "Address: tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq"
    exit 1
fi

NEW_FUNDING_UTXO="$1"
NEW_FUNDING_VALUE="$2"

# Parse txid:vout
NEW_TXID=$(echo "$NEW_FUNDING_UTXO" | cut -d: -f1)
NEW_VOUT=$(echo "$NEW_FUNDING_UTXO" | cut -d: -f2)

# Calculate total inputs
TOTAL_INPUTS=$((COMMIT_VALUE + NEW_FUNDING_VALUE))

# Check if enough funds
if [ "$TOTAL_INPUTS" -lt "$TOTAL_OUTPUTS" ]; then
    echo "Error: Not enough funds!"
    echo "Total inputs: $TOTAL_INPUTS sats"
    echo "Required outputs: $TOTAL_OUTPUTS sats"
    echo "Shortfall: $((TOTAL_OUTPUTS - TOTAL_INPUTS)) sats"
    exit 1
fi

echo "Building reveal transaction..."
echo "Commit input: ${COMMIT_TXID}:${COMMIT_VOUT} (${COMMIT_VALUE} sats)"
echo "Funding input: ${NEW_TXID}:${NEW_VOUT} (${NEW_FUNDING_VALUE} sats)"
echo "Total inputs: ${TOTAL_INPUTS} sats"
echo "Total outputs: ${TOTAL_OUTPUTS} sats"
echo "Fee: $((TOTAL_INPUTS - TOTAL_OUTPUTS)) sats"
echo ""

# Create raw transaction with both inputs
# The outputs must match EXACTLY the original (SIGHASH_ALL)
RAW_TX=$(bitcoin-cli -testnet4 createrawtransaction \
    "[{\"txid\":\"${NEW_TXID}\",\"vout\":${NEW_VOUT}},{\"txid\":\"${COMMIT_TXID}\",\"vout\":${COMMIT_VOUT}}]" \
    "[{\"tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq\":0.00000547},{\"tb1qrk6da5g0592sx6lmgpchaf5qy2lgn8am7cuf3a\":0.00001434},{\"tb1qr25l2p34sv4wnz4q0cuh4g9jd9qh2eua6y5awq\":0.00996853}]")

echo "Raw transaction (unsigned): $RAW_TX"
echo ""

# Sign the funding input (input 0) with our private key
echo "Signing funding input..."
SIGNED_TX=$(bitcoin-cli -testnet4 signrawtransactionwithkey "$RAW_TX" \
    '["cPcsryL9DZi2HjM1saec7aa8k25RTD2poe7SLph6yJDciCQZUPX7"]' \
    "[{\"txid\":\"${NEW_TXID}\",\"vout\":${NEW_VOUT},\"scriptPubKey\":\"00141aa9f50635832ae98aa07e397aa0b2694175679d\",\"witnessScript\":\"\",\"amount\":$(echo "scale=8; $NEW_FUNDING_VALUE / 100000000" | bc)}]" \
    "ALL")

SIGNED_HEX=$(echo "$SIGNED_TX" | jq -r '.hex')
echo "Signed (funding input only): $SIGNED_HEX"
echo ""

# Now we need to add the spell witness to input 1 (commit output)
# This requires manual hex manipulation since bitcoin-cli can't do this
echo "The signed transaction needs the spell witness added to input 1."
echo ""
echo "Spell witness elements:"
echo "  1. Signature: ${SIGNATURE}"
echo "  2. Script: (${#SPELL_SCRIPT} chars)"
echo "  3. Control block: ${CONTROL_BLOCK}"
echo ""
echo "To complete, we need to inject the witness for the commit input."
echo "This requires manual hex editing or a custom tool."

# Save intermediate state
echo "$SIGNED_HEX" > /tmp/reveal_signed_partial.hex
echo "Partial signed tx saved to /tmp/reveal_signed_partial.hex"
