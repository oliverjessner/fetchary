Local HTTPS fixtures for certificate-policy tests. `leaf-key.pem` is a public,
test-only private key and must never be used outside tests.

`root.pem` trusts `intermediate.pem`, which signs `leaf.pem` and `expired.pem`.
The leaf certificates cover `fixture.example.test` and `127.0.0.1`. Serving only
`leaf.pem` simulates a missing intermediate; requesting another hostname tests a
name mismatch. `expired.pem` expired in 2019. `selfsigned.pem` uses the same leaf
key but has no trusted issuer. `hostname.pem` is trusted explicitly by the test
and covers only `fixture.example.test`, to isolate hostname verification.
The remaining certificates expire in 2120 or later.

The fixtures were generated offline with OpenSSL; running tests needs no
certificate-generation tool or public network access.
