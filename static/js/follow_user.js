var $ = require('ep_etherpad-lite/static/js/rjquery').$;

exports.documentReady = function() {
  // Set the title
  $('body').on('mouseover', '#otheruserstable > tbody > tr > td > div', function() {
    $(this).attr('title', 'Watch this author');
  });

  // Watch / follow a user
  $('body').on('click', '#otheruserstable > tbody > tr > td > div', function() {
    $(this).toggleClass('follow-user');
  });
}

exports.isFollowingUser = function(userId) {
  return $('#otheruserstable > tbody > tr[data-authorid="' + userId + '"] > td > div').hasClass('follow-user');
}
