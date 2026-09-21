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
    redis-cli -h 127.0.0.1 -p 6380 RPUSH list_key val1 val2 val3
    ```
- LRANGE
    ```
    redis-cli -h 127.0.0.1 -p 6380 LRANGE list_key 0 5
    redis-cli -h 127.0.0.1 -p 6380 LRANGE list_key -5 -2
    ```
- LPUSH: the same as RPUSH but prepending intead of appending
- LPOP
    ```
    redis-cli -h 127.0.0.1 -p 6380 lpop list_key # pop the first element
    redis-cli -h 127.0.0.1 -p 6380 lpop list_key 3 # pop the first 3 elements
    ```
- BLPOP (Blocking List Pop) 
    Blocks a client until an element is available on one list, or until the specified timeout (in seconds) is reached. A timeout of `0` blocks indefinitely; if no element arrives before the timeout expires, the server responds with a null array (`*-1\r\n`).

    When multiple clients are blocked on the same list, they are served in FIFO order; the client that blocked first receives the next pushed element first. The response is a two-element RESP array containing the list key name and the popped element.

    Internally, blocked clients are held in a per-key waiting queue; when `RPUSH` delivers new elements, they are handed directly to waiting clients (bypassing the list storage entirely) before any remainder is appended to the list.

    ```
    redis-cli -h 127.0.0.1 -p 6380 blpop list_key2 30 # client 1
    redis-cli -h 127.0.0.1 -p 6380 blpop list_key2 10 # client 2
    redis-cli -h 127.0.0.1 -p 6380 rpush list_key2 1000 200 # client 3
    ```
- TYPE (cache has the highest priority)
    ```
    redis-cli -h 127.0.0.1 -p 6380 TYPE key # string or none if invalid key
    ```
- XADD
    ```
    redis-cli -h 127.0.0.1 -p 6380 XADD stream_key 1526919030474-0 temperature 36 humidity 95
    redis-cli -h 127.0.0.1 -p 6380 XADD stream_key 1526919030474-* temperature 36 humidity 95
    redis-cli -h 127.0.0.1 -p 6380 XADD stream_key * temperature 36 humidity 95 # use \* if you have the Shell Globbing issue
    ```
- XRANGE
    ```
    redis-cli -h 127.0.0.1 -p 6380 XRANGE stream_key 1526919-0 1526919-5
    redis-cli -h 127.0.0.1 -p 6380 XRANGE stream_key - +    # - : start from the 1st entry, + : end with the last entry
    redis-cli -h 127.0.0.1 -p 6380 XRANGE stream_key - 1526919-5
    redis-cli -h 127.0.0.1 -p 6380 XRANGE stream_key 1526919-2 +
    ```
- XREAD
    ```
    redis-cli -h 127.0.0.1 -p 6380 XREAD STREAMS <key1> <key2> ... <id1> <id2> ...
    redis-cli -h 127.0.0.1 -p 6380 XREAD BLOCK <milliseconds> STREAMS <key> <id>
    ```
- INCR
    ```
    redis-cli -h 127.0.0.1 -p 6380 INCR <key>
    ```
- MULTI and EXEC
    ```
    redis-cli -h 127.0.0.1 -p 6380  # open in interactive mode
    MULTI    # start a transaction to queue commands
    <command 1>
    <command 2>
    <...>
    EXEC     # execute queued commands and send a RESP array of the result
    ```
