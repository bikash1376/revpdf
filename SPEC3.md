# Updates P1

0. Make sure we follow material design components and icons from google
1. Fix the broken pdf reader, getting blur, blur on zoom, text selection.
2. When a text is selected any type of file - show start and end points like this instead of default one @ref\text-selection.png.
3. Have 2 rounded buttons when user selects a text - highlight icon (clicking on it will highlight the text), and a browser icon that will have a gradient revolving around it - clicking on it will open the bottom bar of search as it is right now. Make sure the text is searched in background just after the user selects it so clicking on it will open the search and it already has the search results.
4. User can choose in reader settings - their default highlight color.
5. Few more things are broken such as text display when the user changes theme. the problem is when the user chooses a theme lets say twilight or sepia or white (just an example, can happen in any theme) and some text in the document epub/pdf any format has bacground white or black or any color (just some particular text), the text doesnt display - basically it turns as all the other text and user cant see. check how we can fix this. 
6. DOC, DOCX formats doesnt open fix it.
7. When opening html i  dont see the option of file and browser tab - it directly renders the html - i want two tab options on top to switch and see.
8. HTML and json should have syntax highlighting and some mono font by default and line numbers and also formatting.
-----

# After we are done with the above - Updates P2

1. When the user opens the app for the first time instead of full empty state - a quote or a thing - that EPUBs are better than PDF - Try now button - that converts the pdf into epub. While its being done- show a loading animation (progress kind of but not very generic - waves or something i think theres one by material design) and this should be on top with text "setting this up.." and on the center or center to bottom show a video demo of how to use  (ill create one 8-10s video for now keep a dummy one from stock). as soon as the video completes it starts looping but the conversion is also done in the meantime so it shows a blue tick animation or green tick (something like google pay maybe) that its converted - Open now and the demo and stuff closes. this will only happen when the user opens the app for the first time not always (in empty state) so thats how we can add the feature. Add document remains as it is for our setup . right?
