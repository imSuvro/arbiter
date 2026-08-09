# Incident response

Classify incidents as one of:

- authentication or secret exposure;
- sandbox escape or unsafe execution;
- queue delivery or duplicate execution;
- verifier correctness;
- provider availability;
- data persistence or artifact loss.

For sandbox or secret incidents, stop new runs first, preserve redacted audit events, rotate affected secrets, and do not delete evidence before the incident record is complete.
