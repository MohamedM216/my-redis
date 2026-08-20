## introduction
my own redis in javascript...

## run
there's more than one option to run commands against the my-redis server
```
redis-cli -h 127.0.0.1 -p 6380 ping
```
```
nc 127.0.0.1 6380
```
```
printf "PING\r\n" | nc -w 1 127.0.0.1 6380
```
```
telnet 127.0.0.1 6380
```
server can handle multiple PINGs & multiple users
```
printf "PING\r\nPING\r\n" | nc -w 1 127.0.0.1 6380
```

## test it already runs correctly
```
redis-cli -h 127.0.0.1 -p 6380 ping
```
you should see:
```
PONG
```
-------------
```
redis-cli -h 127.0.0.1 -p 6380 echo hey
```
you should see:
```
"hey"
```
-------------
```
printf '*2\r\n$4\r\nECHO\r\n$3\r\nhey\r\n' | nc -w 1 127.0.0.1 6380
```
you should see:
```
$3
hey
```

## what logs mean
| symbol | explanation |
|--------|-------------|
|[+] / [-] | When clients connect and disconnect.|
|[<--] | When raw chunks of data arrive.|
|[...] | When the parser is waiting for more TCP data.|
|[PARSER] | When a command is successfully extracted.|
|[EXEC] / [-->] | What command is running and what response is being sent back.|

## docs
### commands
- ECHO
```
redis-cli -h 127.0.0.1 -p 6380 ping "optional message"
```
- SET command
```
redis-cli -h 127.0.0.1 -p 6380 set key value
```
- GET command
```
redis-cli -h 127.0.0.1 -p 6380 get key
```
- RPUSH
```
redis-cli -h 127.0.0.1 -p 6380 RPUSH list_key val1 val2 val3...
```
- LRANGE
```
redis-cli -h 127.0.0.1 -p 6380 LRANGE list_key 0 5
```
```
redis-cli -h 127.0.0.1 -p 6380 LRANGE list_key -5 -2
```